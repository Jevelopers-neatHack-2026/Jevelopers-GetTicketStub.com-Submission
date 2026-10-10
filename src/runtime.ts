import { ConnectorError, type ConnectorErrorCode } from "./errors.js";
import { ALL_SHARED_SHAPES, AUXILIARY_SHAPES, CONTRACT_OWNERSHIP, INPUT_SHAPES, OUTPUT_SHAPES, uniqueShapes } from "./contracts.js";
import type {
  AdapterCallContext,
  AttemptEffectState,
  AuthorizationCheck,
  BudgetRequest,
  CancelCommand,
  CancelResult,
  CapabilityQuery,
  Clock,
  ConnectorCapabilities,
  ConnectorResponse,
  ContractBinding,
  ContractReceipt,
  ContractReadiness,
  ContractValidator,
  Operation,
  PreflightCommand,
  PreflightReport,
  PreSubmitContext,
  ProviderAdapter,
  ProviderMode,
  ProviderResult,
  QuoteCommand,
  QuoteResult,
  RuntimeAudit,
  RuntimeDependencies,
  RuntimeOptions,
  ProviderTransportRequest,
  SharedShape,
  ShipmentCommand,
  ShipmentResult,
  StatusCommand,
  StatusResult,
  SubmitAttemptRecord,
  SubmitCommand,
  SubmitResult,
  TrustedScope,
  UsageEvent
} from "./types.js";

const RUNTIME_VERSION = "0.1.0";
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

interface ExecuteHooks<T> {
  readonly onSuccess?: (value: T, sideEffectState: AttemptEffectState) => Promise<void>;
  readonly onFailure?: (sideEffectState: AttemptEffectState) => Promise<void>;
}

export class FulfillmentConnectorRuntime {
  readonly mode: ProviderMode;
  private readonly sandboxEnabled: boolean;
  private diagnosticCounter = 0;

  constructor(
    private readonly adapter: ProviderAdapter,
    private readonly dependencies: RuntimeDependencies,
    options: RuntimeOptions = {}
  ) {
    this.mode = options.mode ?? "simulated";
    this.sandboxEnabled = options.sandboxEnabled === true;
  }

  audit(): RuntimeAudit {
    const contractReadiness = this.contractReadiness();
    const sandboxReasons: string[] = [];
    if (!this.sandboxEnabled) sandboxReasons.push("sandbox mode was not explicitly enabled");
    if (!contractReadiness.ready) sandboxReasons.push("one or more accepted shared-contract pins are missing");
    if (!this.adapter.descriptor.supportedModes.includes("sandbox")) sandboxReasons.push("provider adapter does not declare sandbox support");
    if (this.dependencies.transport.mode !== "sandbox") sandboxReasons.push("injected transport is not bound to sandbox mode");
    return {
      runtimeVersion: RUNTIME_VERSION,
      defaultMode: "simulated",
      liveModeSupported: false,
      contractReadiness,
      sandboxReady: sandboxReasons.length === 0,
      sandboxReasons
    };
  }

  async discoverCapabilities(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<ConnectorCapabilities>> {
    const command = await this.decode<CapabilityQuery>("discover_capabilities", envelope, trustedScope);
    void command;
    const capabilities: ConnectorCapabilities = {
      ...this.adapter.descriptor,
      mode: this.mode
    };
    return this.execute("discover_capabilities", trustedScope, async () => ({
      status: "supported",
      value: capabilities
    }));
  }

  async quote(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<QuoteResult>> {
    const command = await this.decode<QuoteCommand>("quote", envelope, trustedScope);
    if (!Number.isSafeInteger(command.quantity) || command.quantity <= 0) {
      throw this.failure("quote", "invalid_input", "not_dispatched");
    }
    return this.execute("quote", trustedScope, async (context) => {
      const result = await this.adapter.quote(command, context);
      if (result.status === "supported" && !this.validQuoteResult(result.value)) {
        throw this.failure("quote", "invalid_input", "not_dispatched");
      }
      return result;
    });
  }

  async preflight(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<PreflightReport>> {
    const command = await this.decode<PreflightCommand>("preflight", envelope, trustedScope);
    return this.execute("preflight", trustedScope, (context) => this.adapter.preflight(command, context));
  }

  async submit(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<SubmitResult>> {
    const command = await this.decode<SubmitCommand>("submit", envelope, trustedScope);
    this.validateSubmissionCommand(command, "submit");
    this.assertProviderSupport("submit");
    this.validateSubmissionDeclaration();

    let preSubmit: ProviderResult<PreflightReport>;
    try {
      preSubmit = await this.adapter.validateBeforeSubmit(command, {
        mode: this.mode,
        clock: this.dependencies.clock,
        trustedScope
      });
    } catch (error) {
      throw this.normalizeFailure(error, "submit", "not_dispatched", false);
    }
    if (preSubmit === null || typeof preSubmit !== "object" || !["supported", "unsupported"].includes(preSubmit.status)) {
      throw this.failure("submit", "provider_failure", "not_dispatched");
    }
    if (preSubmit.status === "unsupported") {
      throw this.failure("submit", "unsupported", "not_dispatched");
    }
    if (preSubmit.value === null || typeof preSubmit.value !== "object" || typeof preSubmit.value.valid !== "boolean") {
      throw this.failure("submit", "provider_failure", "not_dispatched");
    }
    if (!preSubmit.value.valid) {
      const staleQuote = Array.isArray(preSubmit.value.issues) && preSubmit.value.issues.some(
        (issue) => issue !== null && typeof issue === "object" && issue.code === "stale_quote"
      );
      throw this.failure("submit", staleQuote ? "stale_quote" : "invalid_input", "not_dispatched");
    }

    const budgetRequest: BudgetRequest = {
      amountMinor: command.amountMinor,
      currency: command.currency,
      purpose: "fulfillment_submit"
    };
    const canonicalBudgetPayload = await this.encodeAuxiliaryPayload(
      "submit",
      "budget_reservation",
      budgetRequest,
      trustedScope
    );

    let existing: SubmitAttemptRecord | undefined;
    try {
      existing = await this.dependencies.persistence.getSubmitAttempt(
        this.adapter.descriptor.providerId,
        trustedScope,
        command.idempotencyKey
      );
    } catch {
      throw this.failure("submit", "persistence_unavailable", "not_dispatched");
    }
    if (existing !== undefined) {
      if (existing.requestFingerprint !== command.requestFingerprint) {
        throw this.failure("submit", "idempotency_conflict", existing.sideEffectState);
      }
      if (existing.sideEffectState === "confirmed") {
        throw this.failure("submit", "duplicate_submission", "confirmed");
      }
      if (existing.sideEffectState === "possible" || existing.sideEffectState === "unknown") {
        throw this.failure("submit", "ambiguous_submission", existing.sideEffectState);
      }
    }

    const authorization: AuthorizationCheck = {
      authorizationEnvelope: command.authorizationEnvelope,
      trustedScope,
      operation: "submit",
      requestFingerprint: command.requestFingerprint
    };
    try {
      const result = await this.dependencies.authorizationVerifier.verify(authorization);
      if (!result.authorized) throw this.failure("submit", "stale_authorization", "not_dispatched");
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw this.failure("submit", "authorization_unavailable", "not_dispatched");
    }

    const claim: SubmitAttemptRecord = {
      providerId: this.adapter.descriptor.providerId,
      tenantId: trustedScope.tenantId,
      projectId: trustedScope.projectId,
      idempotencyKey: command.idempotencyKey,
      claimId: this.newReference(),
      requestFingerprint: command.requestFingerprint,
      sideEffectState: "unknown",
      updatedAt: this.dependencies.clock.now()
    };
    let claimResult;
    try {
      claimResult = await this.dependencies.persistence.claimSubmitAttempt(claim);
    } catch {
      throw this.failure("submit", "persistence_unavailable", "not_dispatched");
    }
    if (!claimResult.claimed) {
      const occupied = claimResult.existing;
      if (occupied === undefined) throw this.failure("submit", "persistence_unavailable", "not_dispatched");
      if (occupied.requestFingerprint !== command.requestFingerprint) {
        throw this.failure("submit", "idempotency_conflict", occupied.sideEffectState);
      }
      if (occupied.sideEffectState === "confirmed") {
        throw this.failure("submit", "duplicate_submission", "confirmed");
      }
      throw this.failure("submit", "ambiguous_submission", occupied.sideEffectState === "not_dispatched" ? "unknown" : occupied.sideEffectState);
    }

    let completed: SubmitResult | undefined;
    return this.execute(
      "submit",
      trustedScope,
      async (context) => {
        try {
          const result = await this.dependencies.budgetClient.authorize({
            contractPayload: canonicalBudgetPayload,
            trustedScope,
            mode: this.mode
          });
          if (!result.authorized) throw this.failure("submit", "budget_denied", "not_dispatched");
        } catch (error) {
          if (error instanceof ConnectorError) throw error;
          throw this.failure("submit", "budget_unavailable", "not_dispatched");
        }
        return this.adapter.submit(command, context);
      },
      {
        onSuccess: async (value) => {
          completed = value;
          await this.dependencies.persistence.saveSubmitAttempt({
            ...claim,
            sideEffectState: "confirmed",
            providerRequestId: value.providerRequestId,
            updatedAt: this.dependencies.clock.now()
          });
        },
        onFailure: async (sideEffectState) => {
          await this.dependencies.persistence.saveSubmitAttempt({
            ...claim,
            sideEffectState,
            ...(completed === undefined ? {} : { providerRequestId: completed.providerRequestId }),
            updatedAt: this.dependencies.clock.now()
          });
        }
      }
    );
  }

  async getStatus(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<StatusResult>> {
    const command = await this.decode<StatusCommand>("status", envelope, trustedScope);
    return this.execute("status", trustedScope, (context) => this.adapter.getStatus(command, context));
  }

  async observeShipment(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<ShipmentResult>> {
    const command = await this.decode<ShipmentCommand>("shipment", envelope, trustedScope);
    return this.execute("shipment", trustedScope, (context) => this.adapter.observeShipment(command, context));
  }

  async cancel(envelope: unknown, trustedScope: TrustedScope): Promise<ConnectorResponse<CancelResult>> {
    const command = await this.decode<CancelCommand>("cancel", envelope, trustedScope);
    this.validateCancelCommand(command);
    this.assertProviderSupport("cancel");
    const declaration = this.adapter.descriptor.operations.cancel;
    if (declaration.sideEffect !== "external" || declaration.idempotency === "unknown" || declaration.idempotency === "not_applicable") {
      throw this.failure("cancel", "unsupported", "not_dispatched");
    }
    let canonicalBudgetPayload: unknown;
    if (declaration.mayCharge) {
      if (command.budgetRequest === undefined || !this.validBudgetRequest(command.budgetRequest)) {
        throw this.failure("cancel", "invalid_input", "not_dispatched");
      }
      canonicalBudgetPayload = await this.encodeAuxiliaryPayload(
        "cancel",
        "budget_reservation",
        command.budgetRequest,
        trustedScope
      );
    }

    try {
      const result = await this.dependencies.authorizationVerifier.verify({
        authorizationEnvelope: command.authorizationEnvelope,
        trustedScope,
        operation: "cancel",
        requestFingerprint: command.requestFingerprint
      });
      if (!result.authorized) throw this.failure("cancel", "stale_authorization", "not_dispatched");
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw this.failure("cancel", "authorization_unavailable", "not_dispatched");
    }

    return this.execute("cancel", trustedScope, async (context) => {
      if (declaration.mayCharge) {
        try {
          const result = await this.dependencies.budgetClient.authorize({
            contractPayload: canonicalBudgetPayload,
            trustedScope,
            mode: this.mode
          });
          if (!result.authorized) throw this.failure("cancel", "budget_denied", "not_dispatched");
        } catch (error) {
          if (error instanceof ConnectorError) throw error;
          throw this.failure("cancel", "budget_unavailable", "not_dispatched");
        }
      }
      return this.adapter.cancel(command, context);
    });
  }

  private async decode<T>(operation: Operation, envelope: unknown, trustedScope: TrustedScope): Promise<T> {
    this.assertRuntimeMode(operation);
    if (
      trustedScope === null || typeof trustedScope !== "object" ||
      typeof trustedScope.tenantId !== "string" || trustedScope.tenantId.trim() === "" ||
      typeof trustedScope.projectId !== "string" || trustedScope.projectId.trim() === ""
    ) throw this.failure(operation, "scope_mismatch", "not_dispatched");
    const shapes = INPUT_SHAPES[operation];
    for (const shape of uniqueShapes([...shapes, ...OUTPUT_SHAPES[operation], ...AUXILIARY_SHAPES[operation]])) {
      this.assertBindingAvailable(operation, shape);
    }

    let validation;
    try {
      validation = await this.dependencies.contracts.validateInbound<T>({
        operation,
        requiredShapes: shapes,
        envelope,
        trustedScope
      });
    } catch {
      throw this.failure(operation, "contract_rejected", "not_dispatched");
    }
    if (!validation.ok) {
      throw this.failure(operation, validation.failure.code, "not_dispatched");
    }
    this.assertReceipts(operation, validation.receipts, shapes, trustedScope);
    return validation.value;
  }

  private async execute<T>(
    operation: Operation,
    trustedScope: TrustedScope,
    handler: (context: AdapterCallContext) => Promise<ProviderResult<T>>,
    hooks: ExecuteHooks<T> = {}
  ): Promise<ConnectorResponse<T>> {
    this.assertRuntimeMode(operation);
    this.assertProviderSupport(operation);

    let transportCalled = false;
    const context: AdapterCallContext = {
      mode: this.mode,
      clock: this.dependencies.clock,
      transport: {
        mode: this.mode,
        request: <R>(request: ProviderTransportRequest): Promise<R> => {
          transportCalled = true;
          return this.dependencies.transport.request<R>(request);
        }
      }
    };

    try {
      await this.recordUsage({
        operation,
        outcome: "dispatching",
        sideEffectState: "not_dispatched"
      }, trustedScope);
    } catch (error) {
      await this.callFailureHook(hooks, "not_dispatched");
      if (error instanceof ConnectorError) throw error;
      throw this.failure(operation, "usage_sink_unavailable", "not_dispatched");
    }

    let successfulSideEffect = false;
    try {
      const result = await handler(context);
      if (result.status === "unsupported") {
        throw this.failure(operation, "unsupported", transportCalled ? "possible" : "not_dispatched");
      }
      successfulSideEffect = this.adapter.descriptor.operations[operation].sideEffect === "external";
      const sideEffectState = successfulSideEffect ? "confirmed" : "not_dispatched";
      await hooks.onSuccess?.(result.value, sideEffectState);

      const outputShapes = OUTPUT_SHAPES[operation];
      for (const shape of outputShapes) this.assertBindingAvailable(operation, shape);
      let outbound;
      try {
        outbound = await this.dependencies.contracts.validateOutbound({
          operation,
          requiredShapes: outputShapes,
          value: result.value,
          trustedScope
        });
      } catch {
        throw this.failure(operation, "contract_rejected", sideEffectState);
      }
      if (!outbound.ok) {
        throw this.failure(operation, outbound.failure.code, sideEffectState);
      }
      this.assertReceipts(operation, outbound.receipts, outputShapes, trustedScope);
      await this.recordUsageBestEffort({
        operation,
        outcome: "succeeded",
        sideEffectState
      }, trustedScope);
      return {
        operation,
        mode: this.mode,
        providerId: this.adapter.descriptor.providerId,
        value: result.value,
        sharedPayload: outbound.value,
        emittedShapes: outputShapes
      };
    } catch (error) {
      const sideEffectState = this.effectState(error, operation, transportCalled, successfulSideEffect);
      await this.callFailureHook(hooks, sideEffectState);
      await this.recordUsageBestEffort({
        operation,
        outcome: "failed",
        sideEffectState
      }, trustedScope);
      throw this.normalizeFailure(error, operation, sideEffectState, transportCalled);
    }
  }

  private assertRuntimeMode(operation: Operation): void {
    if (!this.adapter.descriptor.supportedModes.includes(this.mode) || this.dependencies.transport.mode !== this.mode) {
      throw this.failure(operation, "mode_mismatch", "not_dispatched");
    }
    if (this.mode === "sandbox" && !this.audit().sandboxReady) {
      throw this.failure(operation, "sandbox_disabled", "not_dispatched");
    }
  }

  private assertProviderSupport(operation: Operation): void {
    if (this.adapter.descriptor.operations[operation].supported !== true) {
      throw this.failure(operation, "unsupported", "not_dispatched");
    }
  }

  private assertBindingAvailable(operation: Operation, shape: SharedShape): void {
    const binding = this.bindingFor(shape);
    if (
      binding.shape !== shape ||
      !["missing", "development_fixture", "accepted"].includes(binding.state) ||
      binding.state === "missing" ||
      typeof binding.schemaVersion !== "string"
    ) {
      throw this.failure(operation, "contract_missing", "not_dispatched");
    }
    if (
      binding.ownerRepository !== CONTRACT_OWNERSHIP[shape].ownerRepository ||
      binding.upstreamIssue !== CONTRACT_OWNERSHIP[shape].upstreamIssue
    ) throw this.failure(operation, "contract_missing", "not_dispatched");
    if (binding.state === "development_fixture" && (typeof binding.fixtureDigest !== "string" || !binding.fixtureDigest.trim())) {
      throw this.failure(operation, "contract_missing", "not_dispatched");
    }
    if (binding.state === "accepted" && (
      typeof binding.sourceRevision !== "string" || !binding.sourceRevision.trim() ||
      typeof binding.fixtureDigest !== "string" || !binding.fixtureDigest.trim()
    )) {
      throw this.failure(operation, "contract_missing", "not_dispatched");
    }
    if (this.mode === "sandbox" && binding.state !== "accepted") {
      throw this.failure(operation, "sandbox_disabled", "not_dispatched");
    }
    if (VERSION_PATTERN.exec(binding.schemaVersion) === null) {
      throw this.failure(operation, "contract_missing", "not_dispatched");
    }
  }

  private assertReceipts(
    operation: Operation,
    receipts: readonly ContractReceipt[],
    expectedShapes: readonly SharedShape[],
    trustedScope: TrustedScope
  ): void {
    const uniqueExpected = uniqueShapes(expectedShapes);
    if (!Array.isArray(receipts) || receipts.length !== uniqueExpected.length) {
      throw this.failure(operation, "contract_rejected", "not_dispatched");
    }
    for (const shape of uniqueExpected) {
      const matching = receipts.filter((receipt) => receipt !== null && typeof receipt === "object" && receipt.shape === shape);
      if (matching.length !== 1) {
        throw this.failure(operation, "contract_rejected", "not_dispatched");
      }
      const receipt = matching[0]!;
      const binding = this.bindingFor(shape);
      if (
        typeof receipt.tenantId !== "string" || typeof receipt.projectId !== "string" ||
        receipt.tenantId !== trustedScope.tenantId || receipt.projectId !== trustedScope.projectId
      ) {
        throw this.failure(operation, "scope_mismatch", "not_dispatched");
      }
      const receiptVersion = typeof receipt.schemaVersion === "string" ? VERSION_PATTERN.exec(receipt.schemaVersion) : null;
      const bindingVersion = typeof binding.schemaVersion === "string" ? VERSION_PATTERN.exec(binding.schemaVersion) : null;
      if (receiptVersion === null || bindingVersion === null || receiptVersion[1] !== bindingVersion[1]) {
        throw this.failure(operation, "unsupported_schema_major", "not_dispatched");
      }
      if (this.mode === "sandbox" && receipt.schemaVersion !== binding.schemaVersion) {
        throw this.failure(operation, "contract_rejected", "not_dispatched");
      }
    }
  }

  private validateSubmissionCommand(command: SubmitCommand, operation: "submit"): void {
    const quote = command.quote;
    if (
      typeof command.idempotencyKey !== "string" ||
      command.idempotencyKey.trim() === "" ||
      typeof command.requestFingerprint !== "string" ||
      command.requestFingerprint.trim() === "" ||
      !Number.isSafeInteger(command.amountMinor) ||
      command.amountMinor <= 0 ||
      typeof command.currency !== "string" ||
      !this.validBudgetRequest({
        amountMinor: command.amountMinor,
        currency: command.currency,
        purpose: "fulfillment_submit"
      }) ||
      quote === null ||
      typeof quote !== "object" ||
      typeof quote.quoteId !== "string" ||
      quote.quoteId.trim() === "" ||
      typeof quote.termsFingerprint !== "string" ||
      quote.termsFingerprint.trim() === "" ||
      typeof quote.productionBundleDigest !== "string" ||
      typeof command.productionBundleDigest !== "string" ||
      command.productionBundleDigest.trim() === "" ||
      !Number.isSafeInteger(quote.totalMinor) ||
      quote.totalMinor <= 0 ||
      typeof quote.currency !== "string" ||
      !/^[A-Z]{3}$/.test(quote.currency) ||
      typeof quote.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(quote.expiresAt))
    ) {
      throw this.failure(operation, "invalid_input", "not_dispatched");
    }
    if (Date.parse(quote.expiresAt) <= this.dependencies.clock.now()) {
      throw this.failure(operation, "stale_quote", "not_dispatched");
    }
    if (
      quote.productionBundleDigest !== command.productionBundleDigest ||
      quote.totalMinor !== command.amountMinor ||
      quote.currency !== command.currency
    ) {
      throw this.failure(operation, "invalid_input", "not_dispatched");
    }
  }

  private validQuoteResult(result: QuoteResult): boolean {
    if (
      result === null || typeof result !== "object" || !Array.isArray(result.breakdown) ||
      typeof result.providerQuoteId !== "string" ||
      result.providerQuoteId.trim() === "" ||
      !/^[A-Z]{3}$/.test(result.currency) ||
      !Number.isSafeInteger(result.totalMinor) ||
      result.totalMinor < 0 ||
      !Number.isFinite(Date.parse(result.expiresAt)) ||
      Date.parse(result.expiresAt) <= this.dependencies.clock.now()
    ) return false;
    let sum = 0;
    for (const line of result.breakdown) {
      if (
        line === null || typeof line !== "object" || typeof line.label !== "string" || line.label.trim() === "" ||
        !Number.isSafeInteger(line.amountMinor) || line.amountMinor < 0
      ) return false;
      sum += line.amountMinor;
      if (!Number.isSafeInteger(sum)) return false;
    }
    return sum === result.totalMinor;
  }

  private validateCancelCommand(command: CancelCommand): void {
    if (
      typeof command.idempotencyKey !== "string" ||
      command.idempotencyKey.trim() === "" ||
      typeof command.requestFingerprint !== "string" ||
      command.requestFingerprint.trim() === "" ||
      typeof command.providerRequestId !== "string" ||
      command.providerRequestId.trim() === "" ||
      (command.budgetRequest !== undefined && !this.validBudgetRequest(command.budgetRequest))
    ) {
      throw this.failure("cancel", "invalid_input", "not_dispatched");
    }
  }

  private validBudgetRequest(request: BudgetRequest): boolean {
    return Number.isSafeInteger(request.amountMinor) && request.amountMinor > 0 && /^[A-Z]{3}$/.test(request.currency);
  }

  private validateSubmissionDeclaration(): void {
    const capability = this.adapter.descriptor.operations.submit;
    if (
      capability.sideEffect !== "external" ||
      !capability.mayCharge ||
      capability.idempotency === "not_applicable" ||
      capability.idempotency === "unknown"
    ) {
      throw this.failure("submit", "unsupported", "not_dispatched");
    }
  }

  private contractReadiness(): ContractReadiness {
    const missingAcceptedPins = ALL_SHARED_SHAPES.flatMap((shape) => {
      const binding = this.bindingFor(shape);
      const complete =
        binding.state === "accepted" &&
        binding.ownerRepository === CONTRACT_OWNERSHIP[shape].ownerRepository &&
        binding.upstreamIssue === CONTRACT_OWNERSHIP[shape].upstreamIssue &&
        typeof binding.schemaVersion === "string" &&
        VERSION_PATTERN.exec(binding.schemaVersion) !== null &&
        typeof binding.sourceRevision === "string" && binding.sourceRevision.trim() !== "" &&
        typeof binding.fixtureDigest === "string" &&
        binding.fixtureDigest.trim() !== "";
      if (complete) return [];
      return [{
        shape,
        ownerRepository: binding.ownerRepository,
        upstreamIssue: binding.upstreamIssue,
        state: binding.state,
        ...(binding.schemaVersion === undefined ? {} : { schemaVersion: binding.schemaVersion }),
        ...(binding.sourceRevision === undefined ? {} : { sourceRevision: binding.sourceRevision }),
        ...(binding.fixtureDigest === undefined ? {} : { fixtureDigest: binding.fixtureDigest })
      }];
    });
    return { ready: missingAcceptedPins.length === 0, missingAcceptedPins };
  }

  private bindingFor(shape: SharedShape): ContractBinding {
    const owner = CONTRACT_OWNERSHIP[shape];
    try {
      const binding = this.dependencies.contracts.binding(shape);
      if (
        binding !== undefined && binding !== null && typeof binding === "object" &&
        typeof binding.state === "string" && typeof binding.ownerRepository === "string" &&
        typeof binding.upstreamIssue === "string"
      ) return binding;
    } catch {
      // Unavailable bindings use the private ownership catalog and remain fail-closed.
    }
    return {
      shape,
      ownerRepository: owner.ownerRepository,
      upstreamIssue: owner.upstreamIssue,
      state: "missing"
    };
  }

  private failure(operation: Operation, code: ConnectorErrorCode, sideEffectState: AttemptEffectState): ConnectorError {
    return new ConnectorError(
      operation,
      code,
      this.newReference(),
      sideEffectState
    );
  }

  private newReference(): string {
    this.diagnosticCounter += 1;
    const nonce = Math.random().toString(36).slice(2, 8);
    return `fc-${this.diagnosticCounter.toString().padStart(6, "0")}-${nonce}`;
  }

  private async releaseSubmitClaim(claim: SubmitAttemptRecord): Promise<void> {
    try {
      await this.dependencies.persistence.saveSubmitAttempt({
        ...claim,
        sideEffectState: "not_dispatched",
        updatedAt: this.dependencies.clock.now()
      });
    } catch {
      throw this.failure("submit", "persistence_unavailable", "not_dispatched");
    }
  }

  private effectState(
    error: unknown,
    operation: Operation,
    transportCalled: boolean,
    successfulSideEffect: boolean
  ): AttemptEffectState {
    if (error instanceof ConnectorError) {
      if (error.sideEffectState === "confirmed") return "confirmed";
      if (error.sideEffectState === "unknown") return "unknown";
    }
    if (successfulSideEffect) return "confirmed";
    if (this.adapter.descriptor.operations[operation].sideEffect === "external" && transportCalled) return "possible";
    return "not_dispatched";
  }

  private normalizeFailure(
    error: unknown,
    operation: Operation,
    sideEffectState: AttemptEffectState,
    transportCalled: boolean
  ): ConnectorError {
    if (error instanceof ConnectorError) {
      return this.failure(operation, error.code, sideEffectState);
    }
    const candidate = error !== null && typeof error === "object" ? error as { name?: unknown; code?: unknown; status?: unknown } : {};
    const name = typeof candidate.name === "string" ? candidate.name : "";
    const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
    const timedOut = name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "ECONNABORTED";
    const rateLimited = candidate.status === 429 || code === "RATE_LIMIT" || code === "RATE_LIMITED";
    const failureCode: ConnectorErrorCode =
      rateLimited ? "rate_limit" :
      timedOut ? (operation === "submit" && transportCalled ? "ambiguous_submission" : "timeout") :
      operation === "submit" && transportCalled ? "ambiguous_submission" :
      "provider_failure";
    return this.failure(operation, failureCode, sideEffectState);
  }

  private async encodeAuxiliaryPayload(
    operation: Operation,
    shape: SharedShape,
    value: unknown,
    trustedScope: TrustedScope
  ): Promise<unknown> {
    this.assertBindingAvailable(operation, shape);
    let result;
    try {
      result = await this.dependencies.contracts.validateOutbound({
        operation,
        requiredShapes: [shape],
        value,
        trustedScope
      });
    } catch {
      throw this.failure(operation, "contract_rejected", "not_dispatched");
    }
    if (!result.ok) throw this.failure(operation, result.failure.code, "not_dispatched");
    this.assertReceipts(operation, result.receipts, [shape], trustedScope);
    return result.value;
  }

  private async recordUsage(
    event: Omit<UsageEvent, "providerId" | "mode" | "recordedAt"> & { operation: Operation },
    trustedScope: TrustedScope
  ): Promise<void> {
    const contractPayload = await this.encodeAuxiliaryPayload(
      event.operation,
      "fulfillment_usage",
      {
        ...event,
        providerId: this.adapter.descriptor.providerId,
        mode: this.mode,
        recordedAt: this.dependencies.clock.now()
      },
      trustedScope
    );
    await this.dependencies.usageSink.record(contractPayload);
  }

  private async recordUsageBestEffort(
    event: Omit<UsageEvent, "providerId" | "mode" | "recordedAt"> & { operation: Operation },
    trustedScope: TrustedScope
  ): Promise<void> {
    try {
      await this.recordUsage(event, trustedScope);
    } catch {
      // The dispatching event is recorded before provider work; its failure state is persisted separately.
    }
  }

  private async callFailureHook<T>(hooks: ExecuteHooks<T>, sideEffectState: AttemptEffectState): Promise<void> {
    try {
      await hooks.onFailure?.(sideEffectState);
    } catch {
      // Keep the original typed failure. Reconciliation must inspect the persisted attempt.
    }
  }
}
