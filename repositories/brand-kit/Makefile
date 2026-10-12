PYTHON ?= python3

.PHONY: check-governance check-inventory check-links check-links-external check-provenance-register check-provenance test check build-tokens check-tokens check-tokens-tailwind

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

check: check-inventory check-links check-governance check-provenance-register check-tokens test
