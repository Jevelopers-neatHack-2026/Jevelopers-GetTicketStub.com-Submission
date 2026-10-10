"use client";
import { useRouter } from "next/navigation";
import type { Stub } from "../types";
import { LeavesMark } from "@/customer/pages/ui";
import { SandboxStrip, Stamp } from "@/customer/desk/Desk";
import { MaterialPicker, ctaVerb, totalLabel } from "./MaterialPicker";
import { TearStrip } from "./TearStrip";
import styles from "./Tray.module.css";

interface Props {
  stub: Stub;
  onChange: (s: Stub) => void;
  onTear: () => void;
  /** Leave the stock and finish pickers out when another panel on the page already holds them. */
  compact?: boolean;
}

/** The paper tray under the stub, in order: stock, finish, the stamped main action, then the tear. */
export function Tray({ stub, onChange, onTear, compact }: Props) {
  const router = useRouter();
  return (
    <section className={styles.tray} aria-label="Print your stub">
      <div className={styles.sandbox}>
        <SandboxStrip />
      </div>
      {!compact && <MaterialPicker stub={stub} onChange={onChange} />}
      <Stamp
        block
        price={totalLabel(stub.material, stub.finish)}
        onClick={() => {
          // Let the stamp land before the page changes.
          window.setTimeout(() => router.push(`/checkout/${stub.id}`), 200);
        }}
      >
        {ctaVerb(stub.material)}
        <LeavesMark />
      </Stamp>
      <TearStrip torn={stub.torn} onTear={onTear} />
    </section>
  );
}
