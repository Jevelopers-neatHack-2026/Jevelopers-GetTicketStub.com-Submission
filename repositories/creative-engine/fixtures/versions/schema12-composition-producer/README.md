# Schema 12 composition producer source

This fixture stores the complete tracked source tree from the exact PR36 API 1.2 / storage schema 12 commit `7cba89a123a19a13e9dd17ed656785dede6b0052`. `manifest.json` pins both the Git tree and compressed archive bytes. Tests unpack the archive, reconstruct the Git tree, and execute that archived `CreativeVersionStore` constructor and composition ports to produce populated schema 12 databases before testing migration to schema 13.

The archive is a full `git archive --format=tar` of tracked files, compressed with `gzip -n`. It contains source and tests only; dependencies are installed from existing locked project manifests during normal setup. No historical Git object is needed at test runtime.
