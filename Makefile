PYTHON ?= python3

.PHONY: check-governance check-inventory check-links check-links-external test check

check-inventory:
	$(PYTHON) tools/check_inventory.py

check-governance:
	$(PYTHON) -I tools/check_governance.py

check-links:
	$(PYTHON) tools/check_links.py

# Network probe; non-deterministic and not part of `check`.
check-links-external:
	$(PYTHON) tools/check_links.py --external

test:
	$(PYTHON) -m unittest discover -s tools/tests -v

check: check-inventory check-links check-governance test
