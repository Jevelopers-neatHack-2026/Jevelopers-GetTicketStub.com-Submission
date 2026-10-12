PYTHON ?= python3
BRAND_OUTPUT ?= out/brand/brand-kit.zip
ASSET_OUTPUT ?= build/asset-review

.PHONY: check-governance check-inventory check-links check-links-external check-provenance-register check-provenance test check build-tokens check-tokens check-tokens-tailwind build-accessibility check-accessibility check-accessibility-browser
.PHONY: build-assets check-assets check-package package-brand package-brand-review check-consumers-local check-consumers check-consumers-browser check-brand-release check-guidelines check-accessibility-browser-regressions

check-inventory:
	$(PYTHON) tools/check_inventory.py

check-governance:
	$(PYTHON) -I tools/check_governance.py

check-links:
	$(PYTHON) tools/check_links.py

# Structural validation of provenance/: coverage, exact hashes, paths, field presence. Honest UNKNOWNs pass.
check-provenance-register:
	$(PYTHON) -I tools/check_provenance.py --register-only

# Production export eligibility. Fails closed (nonzero) until a reviewed allowlist and cleared core rights exist.
# Deliberately not part of `check`.
check-provenance:
	$(PYTHON) -I tools/check_provenance.py

# Network probe; non-deterministic and not part of `check`.
check-links-external:
	$(PYTHON) tools/check_links.py --external

test:
	$(PYTHON) -m unittest discover -s tools/tests -v

# Validate tokens/tokens.json and regenerate tokens/tokens.css, tailwind.preset.js, external-fonts-google.css, token-matrix.md.
build-tokens:
	$(PYTHON) -I tools/build_tokens.py build

# Offline: schema/type/unit/alias/mapping validation, two identical builds, drift against committed outputs,
# CSS/JSON parity, then the token unit tests (invalid-fixture cases). Needs no npm.
check-tokens:
	$(PYTHON) -I tools/build_tokens.py check
	$(PYTHON) -m unittest tools/tests/test_tokens.py

# Real Tailwind build with the pinned dev dependency (npm ci from the lockfile; needs network and Node >= 18).
check-tokens-tailwind: check-tokens
	cd tools/tokens-dev && npm ci --ignore-scripts --no-audit --no-fund
	$(PYTHON) -I tools/check_tokens_tailwind.py

build-accessibility:
	$(PYTHON) -I tools/check_accessibility.py build

# Computed contrast and local negative cases, not a browser or accountable approval.
check-accessibility: check-tokens
	$(PYTHON) -I tools/check_accessibility.py check
	$(PYTHON) -m unittest tools.tests.test_accessibility

# Requires the pinned local dev dependency/browser; never fetches a font/provider.
check-accessibility-browser: check-accessibility check-accessibility-browser-regressions
	node tools/check_accessibility_browser.cjs

check-accessibility-browser-regressions:
	node tools/tests/test_accessibility_browser.cjs

build-assets:
	$(PYTHON) -I tools/build_assets.py build --output-dir "$(ASSET_OUTPUT)"

check-assets:
	$(PYTHON) -I tools/build_assets.py check
	$(PYTHON) -m unittest tools.tests.test_assets -v

# Archive checks require a clean committed candidate; review mode never grants rights.
check-package:
	$(PYTHON) -I tools/build_distribution.py check

package-brand:
	$(PYTHON) -I tools/build_distribution.py build --out "$(BRAND_OUTPUT)"

package-brand-review:
	$(PYTHON) -I tools/build_distribution.py build --mode review --out "$(BRAND_OUTPUT)"

check-consumers-local:
	$(PYTHON) -I tools/check_consumers.py --local

check-consumers:
	$(PYTHON) -I tools/check_consumers.py

# Actual browser inspection of the extracted local review fixtures; no provider calls or consumer ACK.
check-consumers-browser:
	PYTHON="$(PYTHON)" node tools/check_consumer_browser.cjs

check-brand-release:
	$(PYTHON) -I tools/check_brand_release.py

check-guidelines:
	$(PYTHON) -I tools/check_guidelines.py
	$(PYTHON) -m unittest tools.tests.test_guidelines

check: check-inventory check-links check-governance check-provenance-register check-tokens check-accessibility check-guidelines test
