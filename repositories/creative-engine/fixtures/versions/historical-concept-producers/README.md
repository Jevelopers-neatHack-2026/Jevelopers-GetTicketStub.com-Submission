# Historical concept producer source custody

These compressed archives preserve the complete tracked Git trees used by the
schema 0.1.0 and 0.2.0 concept proposal producers. Each archive is the original
`git archive --format=tar` output for the immutable commit recorded in
`manifest.json`, compressed with a fixed gzip timestamp. The source files and
their historical license and provenance files are unchanged.

The fixture extracts each archive, reconstructs the Git tree, and verifies the
commit tree ID before it runs the original proposal constructor, event append,
and replay code. The manifest and test contain independent pins for the source
commit, tree ID, compressed and uncompressed hashes, lengths, and tracked leaf
count. Missing or modified archive bytes fail before extraction. The archives
contain source only; dependencies are installed separately from the current
locked offline fixture setup.
