<!-- entire-graph:begin -->
This repo has the entire-graph code graph installed. Before exploring code with
grep/find/whole-file reads, read .entire/graph-agent.md — resolution-first guidance
for using graph retrieval, focused source inspection, and verification.
@.entire/graph-agent.md
<!-- entire-graph:end -->

## Repository-owned fallback when Entire graph is unavailable

The graph plugin is optional. Attempt the prescribed entire graph search once. If the command is missing, forbidden by the execution environment, exits unsuccessfully, or returns no useful result, continue with rg --files, rg, and focused source reads. Do not install the CLI or plugin, enable checkpoint publishing, or upload repository content as a fallback. Record the unavailable search in the review. The repository workflow also fails closed: it does not install or execute the plugin until a compatible source, release, immutable digest, and generated-file contract are independently reviewed.
