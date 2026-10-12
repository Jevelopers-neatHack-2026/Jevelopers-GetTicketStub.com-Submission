#!/usr/bin/env python3
"""Deterministic, offline checks for the shared .github governance package.

This is a repository-profile validator, not a general GitHub, Markdown, Mermaid,
or integration-evals schema implementation. Its supported subset is documented
in automation-design/reusable-workflows.md.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Mapping
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

import yaml


ROOT = Path(__file__).resolve().parents[1]
CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"
CALLING_WORKFLOW_JOB_KEYS = {
    "name", "uses", "with", "secrets", "strategy", "needs", "if",
    "concurrency", "permissions", "cache-mode",
}
WORKFLOW_TOP_LEVEL_KEYS = {
    "name", "run-name", "on", "permissions", "env", "defaults", "concurrency", "jobs",
}
FORM_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PROJECT_REF_RE = re.compile(r"^[A-Za-z0-9-]+/[1-9][0-9]*$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MARKDOWN_LINK_RE = re.compile(
    r"!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|(?:\\.|[^)\s])+)(?:\s+[^)]*)?\)"
)
REFERENCE_LINK_RE = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)")
HTML_TAG_RE = re.compile(r"<(?:img|source|a)\b[^>]*>", re.IGNORECASE | re.DOTALL)
HTML_ATTR_RE = re.compile(
    r"\b(srcset|src|href|alt)\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))",
    re.IGNORECASE,
)
FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
INLINE_CODE_RE = re.compile(r"(`+)(.*?)\1")


class UniqueKeySafeLoader(yaml.SafeLoader):
    """PyYAML SafeLoader with duplicate-key rejection and YAML 1.2 booleans."""


UniqueKeySafeLoader.yaml_implicit_resolvers = {
    key: [
        (tag, regexp)
        for tag, regexp in resolvers
        if tag != "tag:yaml.org,2002:bool"
    ]
    for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}
UniqueKeySafeLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$"),
    list("tTfF"),
)


def _construct_unique_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in mapping
        except TypeError as exc:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "unhashable mapping key",
                key_node.start_mark,
            ) from exc
        if duplicate:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "duplicate mapping key {!r}".format(key),
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_unique_mapping
)


def load_yaml_text(text: str):
    return yaml.load(text, Loader=UniqueKeySafeLoader)


def _is_mapping(value) -> bool:
    return isinstance(value, Mapping)


def _nonempty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _unknown_keys(value: Mapping, allowed: set[str]) -> list[str]:
    return sorted(str(key) for key in value if key not in allowed)


def _parse_timestamp(value):
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed


def _https_url(value) -> bool:
    if not _nonempty_string(value):
        return False
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and bool(parsed.netloc)
        and bool(parsed.hostname)
        and not parsed.username
        and not parsed.password
    )


def _check_string_fields(mapping, fields, context, errors, required=True):
    for field in fields:
        if field not in mapping:
            if required:
                errors.append("{}: missing required `{}`".format(context, field))
        elif not _nonempty_string(mapping[field]):
            errors.append("{}: `{}` must be a non-empty string".format(context, field))


def _check_string_sequence(value, context, errors, *, allow_comma_string=False):
    if allow_comma_string and isinstance(value, str):
        values = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        values = value
    else:
        errors.append("{} must be a list of strings{}".format(
            context, " or a comma-delimited string" if allow_comma_string else ""
        ))
        return
    if not values:
        errors.append("{} must not be empty".format(context))
    for index, item in enumerate(values):
        if not _nonempty_string(item):
            errors.append("{}[{}] must be a non-empty string".format(context, index))


FORM_TOP_LEVEL = {
    "name", "description", "body", "title", "labels", "assignees", "projects", "type"
}
ELEMENT_TYPES = {"markdown", "input", "textarea", "dropdown", "checkboxes", "upload"}
ELEMENT_ATTRIBUTES = {
    "markdown": {"value"},
    "input": {"label", "description", "placeholder", "value"},
    "textarea": {"label", "description", "placeholder", "value", "render"},
    "dropdown": {"label", "description", "multiple", "options", "default"},
    "checkboxes": {"label", "description", "options"},
    "upload": {"label", "description"},
}
ELEMENT_VALIDATIONS = {
    "markdown": set(),
    "input": {"required", "min_length"},
    "textarea": {"required", "min_length"},
    "dropdown": {"required"},
    "checkboxes": {"required"},
    "upload": {"required", "accept"},
}
STRING_ATTRIBUTES = {"label", "description", "placeholder", "value", "render"}


def validate_form_document(document, path="issue form") -> list[str]:
    errors: list[str] = []
    if not _is_mapping(document):
        return ["{}: top level must be a mapping".format(path)]
    unknown = _unknown_keys(document, FORM_TOP_LEVEL)
    if unknown:
        errors.append("{}: unsupported top-level key(s): {}".format(path, ", ".join(unknown)))
    _check_string_fields(document, ("name", "description"), path, errors)
    if "title" in document and not isinstance(document["title"], str):
        errors.append("{}: `title` must be a string".format(path))
    for key in ("labels", "assignees", "projects"):
        if key in document:
            _check_string_sequence(
                document[key],
                "{} `{}`".format(path, key),
                errors,
                allow_comma_string=key in {"labels", "assignees"},
            )
            if key == "projects":
                projects = document[key]
                if isinstance(projects, list) and any(
                    isinstance(project, str) and not PROJECT_REF_RE.fullmatch(project)
                    for project in projects
                ):
                    errors.append("{} `projects` entries must use `PROJECT-OWNER/PROJECT-NUMBER`".format(path))
    if "type" in document and not _nonempty_string(document["type"]):
        errors.append("{}: `type` must be a non-empty string".format(path))

    body = document.get("body")
    if not isinstance(body, list) or not body:
        errors.append("{}: `body` must be a non-empty list".format(path))
        return errors

    field_ids: set[str] = set()
    for index, element in enumerate(body):
        context = "{} body[{}]".format(path, index)
        if not _is_mapping(element):
            errors.append("{} must be a mapping".format(context))
            continue
        unknown_element_keys = _unknown_keys(element, {"type", "id", "attributes", "validations"})
        if unknown_element_keys:
            errors.append("{}: unsupported key(s): {}".format(context, ", ".join(unknown_element_keys)))
        element_type = element.get("type")
        if element_type not in ELEMENT_TYPES:
            errors.append("{}: `type` must be one of {}".format(context, ", ".join(sorted(ELEMENT_TYPES))))
            continue

        field_id = element.get("id")
        if element_type == "markdown":
            if field_id is not None:
                errors.append("{}: `markdown` elements do not take an `id`".format(context))
        else:
            if not isinstance(field_id, str) or not FORM_ID_RE.fullmatch(field_id):
                errors.append("{}: interactive field requires an id using letters, digits, `_`, or `-`".format(context))
            elif field_id in field_ids:
                errors.append("{}: duplicate field id `{}`".format(context, field_id))
            else:
                field_ids.add(field_id)

        attributes = element.get("attributes", {})
        if not _is_mapping(attributes):
            errors.append("{}: `attributes` must be a mapping".format(context))
            attributes = {}
        allowed_attributes = ELEMENT_ATTRIBUTES[element_type]
        unknown_attributes = _unknown_keys(attributes, allowed_attributes)
        if unknown_attributes:
            errors.append("{}: unsupported {} attribute(s): {}".format(context, element_type, ", ".join(unknown_attributes)))
        if element_type == "markdown":
            if not _nonempty_string(attributes.get("value")):
                errors.append("{}: `markdown` attributes require non-empty `value`".format(context))
        else:
            if not _nonempty_string(attributes.get("label")):
                errors.append("{}: `{}` attributes require a non-empty `label`".format(context, element_type))
        for attr in STRING_ATTRIBUTES.intersection(allowed_attributes):
            if attr in attributes and not isinstance(attributes[attr], str):
                errors.append("{}: attribute `{}` must be a string".format(context, attr))
        if element_type == "dropdown":
            options = attributes.get("options")
            if not isinstance(options, list) or not options:
                errors.append("{}: dropdown `options` must be a non-empty list".format(context))
            elif any(not _nonempty_string(option) for option in options):
                errors.append("{}: each dropdown option must be a non-empty string".format(context))
            elif len(set(options)) != len(options):
                errors.append("{}: dropdown options must be distinct".format(context))
            if "multiple" in attributes and not isinstance(attributes["multiple"], bool):
                errors.append("{}: dropdown `multiple` must be boolean".format(context))
            if "default" in attributes:
                default = attributes["default"]
                if isinstance(default, bool) or not isinstance(default, int):
                    errors.append("{}: dropdown `default` must be an integer option index".format(context))
                elif not isinstance(options, list) or default < 0 or default >= len(options):
                    errors.append("{}: dropdown `default` must index an existing option".format(context))
                elif any(isinstance(option, str) and option.strip().lower() in {"none", "n/a"} for option in options):
                    errors.append("{}: a dropdown default cannot be combined with `None` or `n/a` options".format(context))
        if element_type == "checkboxes":
            options = attributes.get("options")
            if not isinstance(options, list) or not options:
                errors.append("{}: checkboxes `options` must be a non-empty list".format(context))
            else:
                option_labels = []
                for option_index, option in enumerate(options):
                    if not _is_mapping(option):
                        errors.append("{}: checkbox options must be mappings".format(context))
                        continue
                    unknown_option_keys = _unknown_keys(option, {"label", "required"})
                    if unknown_option_keys:
                        errors.append("{}: checkbox option has unsupported key(s): {}".format(context, ", ".join(unknown_option_keys)))
                    if not _nonempty_string(option.get("label")):
                        errors.append("{}: checkbox option {} requires a non-empty label".format(context, option_index))
                    else:
                        option_labels.append(option["label"])
                    if "required" in option and not isinstance(option["required"], bool):
                        errors.append("{}: checkbox option `required` must be boolean".format(context))
                if len(option_labels) != len(set(option_labels)):
                    errors.append("{}: checkbox option labels must be distinct".format(context))

        validations = element.get("validations", {})
        if not _is_mapping(validations):
            errors.append("{}: `validations` must be a mapping".format(context))
            validations = {}
        unknown_validations = _unknown_keys(validations, ELEMENT_VALIDATIONS[element_type])
        if unknown_validations:
            errors.append("{}: unsupported {} validation(s): {}".format(context, element_type, ", ".join(unknown_validations)))
        if "required" in validations and not isinstance(validations["required"], bool):
            errors.append("{}: validation `required` must be boolean".format(context))
        if "min_length" in validations:
            minimum = validations["min_length"]
            if isinstance(minimum, bool) or not isinstance(minimum, int) or minimum < 0:
                errors.append("{}: validation `min_length` must be a non-negative integer".format(context))
        if "accept" in validations and not _nonempty_string(validations["accept"]):
            errors.append("{}: upload validation `accept` must be a non-empty string".format(context))
    return errors


def validate_issue_template_config(document, path=".github/ISSUE_TEMPLATE/config.yml") -> list[str]:
    errors: list[str] = []
    if not _is_mapping(document):
        return ["{}: top level must be a mapping".format(path)]
    unknown = _unknown_keys(document, {"blank_issues_enabled", "contact_links"})
    if unknown:
        errors.append("{}: unsupported key(s): {}".format(path, ", ".join(unknown)))
    if "blank_issues_enabled" in document and not isinstance(document["blank_issues_enabled"], bool):
        errors.append("{}: `blank_issues_enabled` must be boolean".format(path))
    if "contact_links" in document:
        links = document["contact_links"]
        if not isinstance(links, list):
            errors.append("{}: `contact_links` must be a list".format(path))
        else:
            names: set[str] = set()
            for index, link in enumerate(links):
                context = "{} contact_links[{}]".format(path, index)
                if not _is_mapping(link):
                    errors.append("{} must be a mapping".format(context))
                    continue
                unexpected = _unknown_keys(link, {"name", "url", "about"})
                if unexpected:
                    errors.append("{}: unsupported key(s): {}".format(context, ", ".join(unexpected)))
                _check_string_fields(link, ("name", "url", "about"), context, errors)
                name = link.get("name")
                if isinstance(name, str):
                    if name.casefold() in names:
                        errors.append("{}: duplicate contact-link name `{}`".format(context, name))
                    names.add(name.casefold())
                if "url" in link and not _https_url(link["url"]):
                    errors.append("{}: `url` must be an HTTPS URL without embedded credentials".format(context))
    return errors


def _read_yaml(path: Path, errors: list[str]):
    try:
        document = load_yaml_text(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        errors.append("{}: cannot parse YAML: {}".format(path.as_posix(), exc))
        return None
    if document is None:
        errors.append("{}: YAML document is empty or has a null top-level value".format(path.as_posix()))
    return document


def validate_issue_forms(root: Path) -> list[str]:
    errors: list[str] = []
    folder = root / ".github/ISSUE_TEMPLATE"
    if not folder.is_dir():
        return [".github/ISSUE_TEMPLATE directory is missing"]
    config = folder / "config.yml"
    if not config.is_file():
        errors.append(".github/ISSUE_TEMPLATE/config.yml is missing")
    else:
        config_doc = _read_yaml(config, errors)
        if config_doc is not None:
            errors.extend(validate_issue_template_config(config_doc))

    files = sorted(
        path for path in folder.iterdir()
        if path.is_file() and path.name != "config.yml" and path.suffix.lower() in {".yml", ".yaml"}
    )
    if not files:
        errors.append(".github/ISSUE_TEMPLATE has no active YAML issue forms")
    seen_names: set[str] = set()
    for path in files:
        relpath = path.relative_to(root).as_posix()
        document = _read_yaml(path, errors)
        if document is None:
            continue
        errors.extend(validate_form_document(document, relpath))
        name = document.get("name") if _is_mapping(document) else None
        if isinstance(name, str):
            normalized = name.casefold()
            if normalized in seen_names:
                errors.append("{}: duplicate issue-form name `{}`".format(relpath, name))
            seen_names.add(normalized)
    return errors


def _strict_json(path: Path):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate JSON object key: {!r}".format(key))
            result[key] = value
        return result

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)


def _collect_ids(value):
    if isinstance(value, dict):
        if isinstance(value.get("id"), str):
            yield value["id"]
        for child in value.values():
            yield from _collect_ids(child)
    elif isinstance(value, list):
        for child in value:
            yield from _collect_ids(child)


def validate_governance_register(root: Path) -> list[str]:
    path = root / "adoption/governance-register.json"
    errors: list[str] = []
    try:
        data = _strict_json(path)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        return ["adoption/governance-register.json: cannot parse unique-key JSON: {}".format(exc)]
    if not _is_mapping(data):
        return ["adoption/governance-register.json: top level must be an object"]
    required_root = {
        "format_version", "policy_pack_version", "observed_at", "scope", "method",
        "coverage", "issue_map", "category_definitions", "source_catalog", "repositories",
    }
    for key in sorted(required_root - set(data)):
        errors.append("adoption/governance-register.json: missing top-level `{}`".format(key))
    if not _nonempty_string(data.get("format_version")):
        errors.append("governance register `format_version` must be a non-empty string")
    if not _nonempty_string(data.get("policy_pack_version")):
        errors.append("governance register `policy_pack_version` must be a non-empty string")
    if _parse_timestamp(data.get("observed_at")) is None:
        errors.append("governance register `observed_at` must be an ISO-8601 timestamp with timezone")

    source_catalog = data.get("source_catalog")
    if not _is_mapping(source_catalog) or not source_catalog:
        errors.append("governance register `source_catalog` must be a non-empty object")
        source_catalog = {}
    for ref, source in source_catalog.items():
        context = "source_catalog[{!r}]".format(ref)
        if not _nonempty_string(ref) or not _is_mapping(source):
            errors.append("{} must be a named source object".format(context))
            continue
        if not _https_url(source.get("url")):
            errors.append("{} must include a safe HTTPS `url`".format(context))
        if not _nonempty_string(source.get("evidence_snapshot")):
            errors.append("{} is missing `evidence_snapshot`".format(context))
        kind = source.get("kind")
        if kind in {"git_blob", "git_tree"}:
            if not isinstance(source.get("revision"), str) or not SHA_RE.fullmatch(source["revision"]):
                errors.append("{} requires a full 40-character git `revision`".format(context))
            if kind == "git_blob" and not re.fullmatch(r"[0-9a-f]{40}", str(source.get("blob_sha", ""))):
                errors.append("{} requires a 40-character `blob_sha`".format(context))
        elif kind == "github_api":
            if _parse_timestamp(source.get("observed_at")) is None:
                errors.append("{} requires a timezone-aware API `observed_at`".format(context))
        else:
            errors.append("{} has unsupported source kind {!r}".format(context, kind))

    issue_map = data.get("issue_map")
    if not _is_mapping(issue_map) or not issue_map:
        errors.append("governance register `issue_map` must be a non-empty object")
        issue_map = {}
    for issue_key, issue in issue_map.items():
        context = "issue_map[{}]".format(issue_key)
        if not _is_mapping(issue):
            errors.append("{} must be an object".format(context))
            continue
        _check_string_fields(issue, ("url", "title", "owner_role", "scope"), context, errors)
        if not _https_url(issue.get("url")):
            errors.append("{} requires an HTTPS URL".format(context))
        if not isinstance(issue.get("number"), int) or isinstance(issue.get("number"), bool) or issue["number"] <= 0:
            errors.append("{} requires a positive issue number".format(context))
        if issue.get("status") not in {"open", "closed"}:
            errors.append("{} has invalid issue status".format(context))
        if issue.get("planning_status") not in {"planned", "in_progress", "blocked", "verified", "deferred"}:
            errors.append("{} has invalid planning status".format(context))

    categories = data.get("category_definitions")
    if not _is_mapping(categories) or not categories:
        errors.append("governance register `category_definitions` must be a non-empty object")
        categories = {}
    for category_id, category in categories.items():
        context = "category_definitions[{}]".format(category_id)
        if not _is_mapping(category):
            errors.append("{} must be an object".format(context))
            continue
        _check_string_fields(category, ("label", "verification_method"), context, errors)
        vocabulary = category.get("status_vocabulary")
        if not isinstance(vocabulary, list) or not vocabulary or any(not _nonempty_string(x) for x in vocabulary):
            errors.append("{} requires a non-empty string `status_vocabulary`".format(context))
        issue_keys = category.get("implementation_issue_keys")
        if not isinstance(issue_keys, list) or not issue_keys or any(key not in issue_map for key in issue_keys):
            errors.append("{} has missing or unresolved `implementation_issue_keys`".format(context))

    repositories = data.get("repositories")
    if not isinstance(repositories, list) or not repositories:
        errors.append("governance register `repositories` must be a non-empty list")
        repositories = []
    declared_count = data.get("scope", {}).get("mapped_repository_count") if _is_mapping(data.get("scope")) else None
    if declared_count is not None and declared_count != len(repositories):
        errors.append("governance register repository count does not match `scope.mapped_repository_count`")
    repo_ids: set[str] = set()
    repo_names: set[str] = set()
    for index, repo in enumerate(repositories):
        context = "repositories[{}]".format(index)
        if not _is_mapping(repo):
            errors.append("{} must be an object".format(context))
            continue
        _check_string_fields(repo, ("id", "name", "owner_role", "responsibility"), context, errors)
        for key, seen, label in (("id", repo_ids, "id"), ("name", repo_names, "name")):
            value = repo.get(key)
            if isinstance(value, str):
                if value in seen:
                    errors.append("{}: duplicate repository {} `{}`".format(context, label, value))
                seen.add(value)
        revision = repo.get("revision")
        if not _is_mapping(revision) or not isinstance(revision.get("sha"), str) or not SHA_RE.fullmatch(revision["sha"]):
            errors.append("{} requires `revision.sha` to be a full 40-character commit SHA".format(context))
        if not _nonempty_string(repo.get("owner_role_confirmation")):
            errors.append("{} is missing owner-role confirmation status".format(context))
        existing_ids = set(_collect_ids(repo.get("existing_work", {})))
        artifacts = repo.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            errors.append("{} requires a non-empty `artifacts` list".format(context))
            continue
        artifact_ids: set[str] = set()
        for artifact_index, artifact in enumerate(artifacts):
            artifact_context = "{} artifacts[{}]".format(context, artifact_index)
            if not _is_mapping(artifact):
                errors.append("{} must be an object".format(artifact_context))
                continue
            _check_string_fields(artifact, ("category_id", "status", "owner_role", "exact_gap", "verification_ref"), artifact_context, errors)
            category_id = artifact.get("category_id")
            if category_id in artifact_ids:
                errors.append("{}: duplicate artifact category `{}`".format(artifact_context, category_id))
            artifact_ids.add(category_id)
            category = categories.get(category_id) if _is_mapping(categories) else None
            if not _is_mapping(category):
                errors.append("{} refers to unknown category `{}`".format(artifact_context, category_id))
            else:
                vocabulary = category.get("status_vocabulary", [])
                if artifact.get("status") not in vocabulary:
                    errors.append("{} uses a status outside its category vocabulary".format(artifact_context))
                if artifact.get("verification_ref") != category_id:
                    errors.append("{} `verification_ref` must join to its category".format(artifact_context))
                known_issue_keys = set(issue_map)
                keys = artifact.get("implementation_issue_keys")
                if not isinstance(keys, list) or not keys or any(key not in known_issue_keys for key in keys):
                    errors.append("{} has missing or unresolved implementation issue keys".format(artifact_context))
            if artifact.get("owner_role") != repo.get("owner_role"):
                errors.append("{} owner role must match the repository's proposed role".format(artifact_context))
            if _parse_timestamp(artifact.get("observed_at")) is None:
                errors.append("{} requires a timezone-aware `observed_at`".format(artifact_context))
            source_refs = artifact.get("source_refs")
            if not isinstance(source_refs, list) or not source_refs:
                errors.append("{} is missing evidence `source_refs`".format(artifact_context))
            elif any(ref not in source_catalog for ref in source_refs):
                errors.append("{} contains unresolved evidence source reference(s)".format(artifact_context))
            work_refs = artifact.get("existing_work_refs", [])
            if not isinstance(work_refs, list) or any(ref not in existing_ids for ref in work_refs):
                errors.append("{} contains unresolved existing-work reference(s)".format(artifact_context))
            if not _is_mapping(artifact.get("details")):
                errors.append("{} `details` must be an object".format(artifact_context))
    return errors


def _is_within(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _local_target_error(root_real: Path, source: Path, target: str) -> str | None:
    target = target.strip()
    if not target or target.startswith("#"):
        return None
    unescaped = target.replace(r"\(", "(").replace(r"\)", ")")
    try:
        parsed = urlsplit(unescaped)
    except ValueError:
        return "malformed link target"
    if parsed.scheme or parsed.netloc or unescaped.startswith("//"):
        return None
    try:
        local_path = unquote(parsed.path, errors="strict")
    except (UnicodeDecodeError, ValueError):
        return "malformed percent-encoding in local link"
    if not local_path:
        return None
    candidate = (source.parent / local_path).resolve(strict=False)
    if not _is_within(root_real, candidate):
        return "local link escapes checkout"
    if not candidate.exists():
        return "local link target does not exist"
    resolved = candidate.resolve(strict=True)
    if not _is_within(root_real, resolved):
        return "local link resolves outside checkout"
    return None


def _markdown_content_lines(content: str):
    in_fence = False
    fence_char = ""
    fence_len = 0
    for line_number, line in enumerate(content.splitlines(), 1):
        fence_match = FENCE_RE.match(line)
        if fence_match:
            token = fence_match.group(1)
            marker = token[0]
            if not in_fence:
                in_fence, fence_char, fence_len = True, marker, len(token)
            elif marker == fence_char and len(token) >= fence_len and not line.strip().strip(marker).strip():
                in_fence = False
            continue
        if not in_fence:
            yield line_number, INLINE_CODE_RE.sub("", line)


def _link_targets_in_markdown_line(line: str):
    for match in MARKDOWN_LINK_RE.finditer(line):
        target = match.group(1)
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1]
        yield target
    ref_match = REFERENCE_LINK_RE.match(line)
    if ref_match:
        target = ref_match.group(1)
        if target.startswith("<") and target.endswith(">"):
            target = target[1:-1]
        yield target


def _html_references(line: str):
    for tag_match in HTML_TAG_RE.finditer(line):
        tag = tag_match.group(0)
        attrs = {}
        for match in HTML_ATTR_RE.finditer(tag):
            value = next(group for group in match.groups()[1:] if group is not None)
            attrs[match.group(1).lower()] = value
        if tag.lower().startswith("<img") and "alt" not in attrs:
            yield "__MISSING_ALT__"
        for attr in ("src", "href"):
            if attr in attrs:
                yield attrs[attr]
        if "srcset" in attrs:
            for candidate in attrs["srcset"].split(","):
                parts = candidate.strip().split()
                if parts:
                    yield parts[0]


def validate_markdown_links(root: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    root_real = root.resolve(strict=True)
    markdown_files: list[Path] = []
    for current, directories, filenames in os.walk(root, followlinks=False):
        current_path = Path(current)
        kept_dirs = []
        for directory in sorted(directories):
            candidate = current_path / directory
            if candidate.is_symlink():
                resolved = candidate.resolve(strict=False)
                if not _is_within(root_real, resolved):
                    errors.append("{}: directory symlink escapes checkout".format(candidate.relative_to(root).as_posix()))
                continue
            if directory not in {".git", "node_modules", "vendor", ".venv"}:
                kept_dirs.append(directory)
        directories[:] = kept_dirs
        for filename in sorted(filenames):
            candidate = current_path / filename
            if candidate.suffix.lower() not in {".md", ".markdown"}:
                continue
            try:
                resolved = candidate.resolve(strict=True)
            except OSError:
                errors.append("{}: Markdown file cannot be resolved".format(candidate.relative_to(root).as_posix()))
                continue
            if not _is_within(root_real, resolved):
                errors.append("{}: Markdown file resolves outside checkout".format(candidate.relative_to(root).as_posix()))
                continue
            markdown_files.append(candidate)
    if not markdown_files:
        errors.append("checkout contains no Markdown files")
    local_links = 0
    profile_assets = 0
    profile = root / "profile/README.md"
    if not profile.is_file():
        errors.append("profile/README.md is missing")
    for source in sorted(markdown_files):
        relative = source.relative_to(root).as_posix()
        try:
            content = source.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            errors.append("{}: cannot read UTF-8 Markdown: {}".format(relative, exc))
            continue
        for line_number, line in _markdown_content_lines(content):
            targets = list(_link_targets_in_markdown_line(line)) + list(_html_references(line))
            for target in targets:
                if target == "__MISSING_ALT__":
                    errors.append("{}:{}: HTML img is missing an `alt` attribute".format(relative, line_number))
                    continue
                target = target.strip().strip("\"'")
                if not target:
                    continue
                try:
                    parsed = urlsplit(target)
                except ValueError:
                    errors.append("{}:{}: malformed link target ({})".format(relative, line_number, target))
                    continue
                if parsed.scheme or parsed.netloc or target.startswith("//") or target.startswith("#"):
                    continue
                local_links += 1
                error = _local_target_error(root_real, source, target)
                if error:
                    errors.append("{}:{}: {} ({})".format(relative, line_number, error, target))
                elif relative == "profile/README.md" and "assets/" in parsed.path:
                    profile_assets += 1
    if profile.is_file() and profile_assets == 0:
        errors.append("profile/README.md has no checked local assets/ references")
    return errors, {"markdown_files": len(markdown_files), "local_links": local_links, "profile_assets": profile_assets}


def validate_release_template(root: Path) -> list[str]:
    path = root / "templates/release-record.md"
    try:
        content = path.read_text(encoding="utf-8").casefold()
    except (OSError, UnicodeError) as exc:
        return ["templates/release-record.md: cannot read template: {}".format(exc)]
    required_phrases = {
        "release identity": "## release identity and authority",
        "source revision": "source full commit sha",
        "tested component evidence": "## tested components and artifacts",
        "actual command result": "command and actual result",
        "artifact digest": "artifact and digest",
        "acceptance owner": "required acceptance ids and owner",
        "integrated gate": "integrated gate link/result",
        "rollback target": "rollback target artifact and digest",
        "publication authority evidence": "publication authorization/settings evidence",
    }
    return [
        "templates/release-record.md: missing release prerequisite field `{}`".format(label)
        for label, phrase in required_phrases.items()
        if phrase not in content
    ]


def validate_pull_request_template(root: Path) -> list[str]:
    path = root / ".github/pull_request_template.md"
    try:
        content = path.read_text(encoding="utf-8").casefold()
    except (OSError, UnicodeError) as exc:
        return [".github/pull_request_template.md: cannot read template: {}".format(exc)]
    required_sections = (
        "## summary", "## linked issues", "## scope / non-goals", "## ownership & design",
        "## acceptance criteria", "## verification", "## security & provenance", "## risk & rollback",
    )
    errors = [
        ".github/pull_request_template.md: missing required section `{}`".format(section)
        for section in required_sections
        if section not in content
    ]
    if "never paste secrets" not in content:
        errors.append(".github/pull_request_template.md: missing secret-handling reminder")
    return errors


def _permission_map(value) -> bool:
    return _is_mapping(value) and all(
        scope == "contents" and access in {"read", "none"}
        for scope, access in value.items()
    )


def _expression_references_secrets_context(expression: str) -> bool:
    """Detect a root `secrets` identifier outside GitHub expression literals.

    This intentionally recognizes only the lexical detail needed by this
    repository's policy. It is not a GitHub Actions expression parser.
    """
    index = 0
    in_string = False
    while index < len(expression):
        char = expression[index]
        if in_string:
            if char == "'":
                if index + 1 < len(expression) and expression[index + 1] == "'":
                    index += 2
                    continue
                in_string = False
            index += 1
            continue
        if char == "'":
            in_string = True
            index += 1
            continue

        end = index + len("secrets")
        candidate = expression[index:end]
        if candidate.isascii() and candidate.lower() == "secrets":
            before = expression[index - 1] if index else ""
            after = expression[end] if end < len(expression) else ""
            identifier_chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
            if (not before or before not in identifier_chars) and (
                not after or after not in identifier_chars
            ):
                previous_nonspace = index - 1
                while previous_nonspace >= 0 and expression[previous_nonspace].isspace():
                    previous_nonspace -= 1
                # A property named `secrets` on another context is not the
                # GitHub Actions `secrets` context itself.
                if previous_nonspace < 0 or expression[previous_nonspace] != ".":
                    return True
        index += 1

    # An unterminated quote is not a valid expression literal. Fail closed if
    # it contains the token, rather than allowing malformed syntax to hide it.
    if in_string:
        return re.search(
            r"(?<![A-Za-z0-9_-])secrets(?![A-Za-z0-9_-])",
            expression,
            re.IGNORECASE | re.ASCII,
        ) is not None
    return False


def _has_secret_context_reference(value: str, *, implicit_if_expression: bool = False) -> bool:
    """Scan explicit GitHub expressions and, for `if`, its optional bare form."""
    cursor = 0
    found_expression = False
    while True:
        start = value.find("${{", cursor)
        if start < 0:
            break
        found_expression = True
        body_start = start + len("${{")
        index = body_start
        in_string = False
        while index < len(value):
            char = value[index]
            if in_string:
                if char == "'":
                    if index + 1 < len(value) and value[index + 1] == "'":
                        index += 2
                        continue
                    in_string = False
            elif char == "'":
                in_string = True
            elif value.startswith("}}", index):
                if _expression_references_secrets_context(value[body_start:index]):
                    return True
                cursor = index + 2
                break
            index += 1
        else:
            # An incomplete expression is invalid workflow syntax. Scan its
            # remaining text conservatively so a missing terminator cannot
            # hide a context reference.
            return re.search(
                r"(?<![A-Za-z0-9_-])secrets(?![A-Za-z0-9_-])",
                value[body_start:],
                re.IGNORECASE | re.ASCII,
            ) is not None

    if implicit_if_expression and not found_expression:
        return _expression_references_secrets_context(value)
    return False


def validate_workflow_document(document, label="workflow") -> list[str]:
    errors: list[str] = []
    if not _is_mapping(document):
        return ["{}: top level must be a mapping".format(label)]
    unsupported_top_keys = _unknown_keys(document, WORKFLOW_TOP_LEVEL_KEYS)
    if unsupported_top_keys:
        errors.append("{}: unsupported top-level workflow key(s): {}".format(label, ", ".join(unsupported_top_keys)))
    triggers = document.get("on")
    if not _is_mapping(triggers) or not triggers:
        errors.append("{}: `on` must be a non-empty event mapping".format(label))
        triggers = {}
    forbidden = {"pull_request_target", "workflow_run"}.intersection(triggers)
    if forbidden:
        errors.append("{}: forbidden privileged trigger(s): {}".format(label, ", ".join(sorted(forbidden))))
    if not _permission_map(document.get("permissions")):
        errors.append("{}: workflow must declare only `contents: read`/`none` permissions".format(label))
    concurrency = document.get("concurrency")
    is_reusable_only = set(triggers) == {"workflow_call"}
    if not is_reusable_only and (
        not _is_mapping(concurrency)
        or not _nonempty_string(concurrency.get("group"))
        or concurrency.get("cancel-in-progress") is not True
    ):
        errors.append("{}: bounded workflow requires a concurrency group with `cancel-in-progress: true`".format(label))

    jobs = document.get("jobs")
    if not _is_mapping(jobs) or not jobs:
        errors.append("{}: `jobs` must be a non-empty mapping".format(label))
        return errors
    for job_id, job in jobs.items():
        context = "{} jobs.{}".format(label, job_id)
        if not _is_mapping(job):
            errors.append("{} must be a mapping".format(context))
            continue
        permissions = job.get("permissions")
        if not _permission_map(permissions):
            errors.append("{} must explicitly limit permissions to `contents: read`/`none`".format(context))
        job_uses = job.get("uses")
        if job_uses is not None:
            unsupported_call_keys = _unknown_keys(job, CALLING_WORKFLOW_JOB_KEYS)
            if unsupported_call_keys:
                errors.append(
                    "{} reusable-workflow call uses unsupported job key(s): {}".format(
                        context, ", ".join(unsupported_call_keys)
                    )
                )
            if not isinstance(job_uses, str) or not job_uses.startswith("./.github/workflows/") or not job_uses.endswith((".yml", ".yaml")):
                errors.append("{} reusable workflow must use a repository-local workflow path".format(context))
            if job.get("secrets") is not None and job.get("secrets") != {}:
                errors.append("{} must not pass workflow secrets".format(context))
            if "timeout-minutes" in job:
                errors.append("{}: `timeout-minutes` is not supported on a reusable-workflow call job".format(context))
            continue
        timeout = job.get("timeout-minutes")
        if isinstance(timeout, bool) or not isinstance(timeout, int) or timeout < 1 or timeout > 15:
            errors.append("{} must have a bounded `timeout-minutes` from 1 to 15".format(context))
        if job.get("runs-on") != "ubuntu-latest":
            errors.append("{} must use the public `ubuntu-latest` runner".format(context))
        steps = job.get("steps")
        if not isinstance(steps, list) or not steps:
            errors.append("{} must have a non-empty `steps` list".format(context))
            continue
        for step_index, step in enumerate(steps):
            step_context = "{} steps[{}]".format(context, step_index)
            if not _is_mapping(step):
                errors.append("{} must be a mapping".format(step_context))
                continue
            if ("uses" in step) == ("run" in step):
                errors.append("{} must declare exactly one of `uses` or `run`".format(step_context))
            if "uses" in step:
                action = step["uses"]
                if not isinstance(action, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}", action):
                    errors.append("{} external action must be pinned to a full 40-character commit SHA".format(step_context))
                if isinstance(action, str) and action.startswith("actions/checkout@"):
                    if action != "actions/checkout@{}".format(CHECKOUT_SHA):
                        errors.append("{} checkout pin does not match the reviewed v7.0.1 SHA".format(step_context))
                    with_values = step.get("with", {})
                    if not _is_mapping(with_values) or with_values.get("persist-credentials") is not False:
                        errors.append("{} checkout must set `persist-credentials: false`".format(step_context))
            elif "run" not in step:
                errors.append("{} must declare `uses` or `run`".format(step_context))
    def has_secret_reference(value, seen=None, implicit_if_expression=False):
        if seen is None:
            seen = set()
        if isinstance(value, dict):
            identity = id(value)
            if identity in seen:
                return False
            seen.add(identity)
            if "secrets" in value and value["secrets"] not in (None, {}, []):
                return True
            return any(
                has_secret_reference(
                    child,
                    seen,
                    implicit_if_expression=(key == "if"),
                )
                for key, child in value.items()
            )
        if isinstance(value, list):
            identity = id(value)
            if identity in seen:
                return False
            seen.add(identity)
            return any(has_secret_reference(child, seen) for child in value)
        return isinstance(value, str) and _has_secret_context_reference(
            value,
            implicit_if_expression=implicit_if_expression,
        )

    if has_secret_reference(document):
        errors.append("{} must not declare, reference, or inherit secrets".format(label))
    return errors


def validate_workflows(root: Path) -> list[str]:
    folder = root / ".github/workflows"
    if not folder.is_dir():
        return [".github/workflows directory is missing"]
    files = sorted(path for path in folder.iterdir() if path.is_file() and path.suffix.lower() in {".yml", ".yaml"})
    if not files:
        return [".github/workflows has no executable workflow files"]
    errors: list[str] = []
    for path in files:
        label = path.relative_to(root).as_posix()
        try:
            document = load_yaml_text(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            errors.append("{}: cannot parse workflow YAML: {}".format(label, exc))
            continue
        errors.extend(validate_workflow_document(document, label))

    caller = root / ".github/workflows/governance-checks.yml"
    if caller.is_file():
        try:
            document = load_yaml_text(caller.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError):
            document = None
        if _is_mapping(document):
            triggers = document.get("on", {})
            allowed_events = {"pull_request", "push", "workflow_dispatch"}
            if set(triggers) != allowed_events:
                errors.append("governance-checks.yml must use only pull_request, push, and workflow_dispatch triggers")
            if triggers.get("push", {}).get("branches") != ["main"]:
                errors.append("governance-checks.yml pushes must be limited to `main`")
            if triggers.get("pull_request", {}).get("branches") != ["main"]:
                errors.append("governance-checks.yml pull requests must target `main`")
            jobs = document.get("jobs", {})
            docs_job = jobs.get("docs", {}) if _is_mapping(jobs) else {}
            if not _is_mapping(docs_job) or docs_job.get("uses") != "./.github/workflows/docs-check.yml":
                errors.append("governance-checks.yml must call the installed docs-check reusable workflow")
            elif docs_job.get("with", {}).get("scope") != "repository":
                errors.append("governance-checks.yml must call docs-check with repository scope")
    return errors


def validate_observation_snapshot(root: Path) -> list[str]:
    path = root / "adoption/observations/organization-adoption-2026-10-12.json"
    errors: list[str] = []
    try:
        data = _strict_json(path)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        return ["{}: cannot parse unique-key JSON: {}".format(path.relative_to(root).as_posix(), exc)]
    label = path.relative_to(root).as_posix()
    if not _is_mapping(data):
        return ["{}: top level must be an object".format(label)]
    expected_top = {
        "schema_version", "observed_at", "head_metadata_observed_at", "settings_observed_at",
        "latest_default_branch_heads",
        "observer", "scope", "summary", "authoring_runtime", "repositories",
    }
    unknown_top = _unknown_keys(data, expected_top)
    if unknown_top:
        errors.append("{}: unsupported top-level key(s): {}".format(label, ", ".join(unknown_top)))
    if data.get("schema_version") != "1.0":
        errors.append("{}: `schema_version` must be `1.0`".format(label))
    snapshot_time = _parse_timestamp(data.get("observed_at"))
    if snapshot_time is None or snapshot_time.utcoffset() != timezone.utc.utcoffset(snapshot_time):
        errors.append("{}: `observed_at` must be timezone-aware UTC ISO-8601".format(label))
    elif snapshot_time.date() != date(2026, 10, 12):
        errors.append("{}: snapshot timestamp does not match the dated filename".format(label))
    head_metadata_time = _parse_timestamp(data.get("head_metadata_observed_at"))
    if (
        head_metadata_time is None
        or head_metadata_time.utcoffset() != timezone.utc.utcoffset(head_metadata_time)
    ):
        errors.append("{}: `head_metadata_observed_at` must be timezone-aware UTC ISO-8601".format(label))
    elif snapshot_time is not None and (
        head_metadata_time.date() != snapshot_time.date() or head_metadata_time <= snapshot_time
    ):
        errors.append("{}: head metadata must be a later same-day observation than the pinned trees".format(label))
    settings_time = _parse_timestamp(data.get("settings_observed_at"))
    if settings_time is None or settings_time.utcoffset() != timezone.utc.utcoffset(settings_time):
        errors.append("{}: `settings_observed_at` must be timezone-aware UTC ISO-8601".format(label))
    elif head_metadata_time is not None and settings_time != head_metadata_time:
        errors.append("{}: `settings_observed_at` must equal `head_metadata_observed_at`".format(label))
    _check_string_fields(data, ("observer",), label, errors)

    scope = data.get("scope")
    if not _is_mapping(scope):
        errors.append("{}: `scope` must be an object".format(label))
        scope = {}
    _check_string_fields(scope, ("organization", "inventory_source"), label + " scope", errors)
    expected_scope = {
        "repository_count": 16,
        "metadata_inspected": 16,
        "public_tree_inspected": 15,
        "private_source_unavailable": 1,
        "public_consumer_count": 14,
        "private_details_withheld": True,
    }
    if any(scope.get(key) != value for key, value in expected_scope.items()):
        errors.append("{}: scope counts/private handling do not preserve the 16/15/14 snapshot boundary".format(label))
    organization = scope.get("organization")

    runtime = data.get("authoring_runtime")
    if not _is_mapping(runtime):
        errors.append("{}: `authoring_runtime` must be an object".format(label))
        runtime = {}
    _check_string_fields(
        runtime,
        (
            "model", "reasoning_effort", "service_tier", "route", "pack_version",
            "receipt_path", "metadata_source",
        ),
        label + " authoring_runtime",
        errors,
    )
    if (
        runtime.get("model") != "gpt-6-luna"
        or runtime.get("reasoning_effort") != "max"
        or runtime.get("service_tier") != "priority"
        or runtime.get("route") != "Fast"
        or runtime.get("pack_version") != "1.1.0"
    ):
        errors.append("{}: authoring runtime does not match the assigned pack 1.1.0 route".format(label))
    if runtime.get("usage") is not None or runtime.get("cost") is not None:
        errors.append("{}: unexposed runtime usage and cost must remain null".format(label))
    if runtime.get("receipt_path") != "unavailable (no per-call execution receipt exposed)":
        errors.append("{}: runtime receipt must state when no per-call receipt is exposed".format(label))
    metadata_source = runtime.get("metadata_source")
    if not isinstance(metadata_source, str) or "task delegation routing instruction" not in metadata_source.casefold():
        errors.append("{}: runtime metadata source must identify the task delegation routing instruction".format(label))

    summary = data.get("summary")
    if not _is_mapping(summary):
        errors.append("{}: `summary` must be an object".format(label))
        summary = {}
    rows = data.get("repositories")
    if not isinstance(rows, list) or len(rows) != 15:
        errors.append("{}: public snapshot must contain exactly 15 public repository records".format(label))
        rows = rows if isinstance(rows, list) else []
    if (
        summary.get("public_repository_records") != len(rows)
        or summary.get("private_metadata_records") != 1
        or summary.get("verified_adopted_consumers") != 0
    ):
        errors.append("{}: summary counts do not match public records/private aggregation/adoption state".format(label))

    expected_artifacts = {
        "agents_md", "contributing", "code_of_conduct", "security", "support", "ownership_docs",
        "issue_forms", "pull_request_template", "workflow_files", "adoption_record", "adoption_register", "codeowners",
    }
    allowed_artifact_states = {"present", "absent", "unknown"}
    expected_row_keys = {
        "name", "visibility", "role", "default_branch", "head_sha", "observed_at", "source_url",
        "tree_status", "artifacts", "nested_paths", "local_overrides", "workflow_audit", "settings", "adoption_status",
    }
    names: set[str] = set()
    latest_heads = data.get("latest_default_branch_heads")
    latest_head_names: set[str] = set()
    if not isinstance(latest_heads, list) or len(latest_heads) != 15:
        errors.append("{}: latest head metadata must contain exactly 15 public repository records".format(label))
        latest_heads = latest_heads if isinstance(latest_heads, list) else []
    for index, latest in enumerate(latest_heads):
        context = "{} latest_default_branch_heads[{}]".format(label, index)
        if not _is_mapping(latest):
            errors.append("{} must be an object".format(context))
            continue
        if set(latest) != {"name", "head_sha", "observed_at"}:
            errors.append("{} may contain only public name, head SHA, and observation time".format(context))
        _check_string_fields(latest, ("name", "head_sha", "observed_at"), context, errors)
        latest_name = latest.get("name")
        if isinstance(latest_name, str):
            if latest_name in latest_head_names:
                errors.append("{}: duplicate latest-head repository name".format(context))
            latest_head_names.add(latest_name)
        latest_sha = latest.get("head_sha")
        if not isinstance(latest_sha, str) or not SHA_RE.fullmatch(latest_sha):
            errors.append("{}: `head_sha` must be a full 40-character commit SHA".format(context))
        latest_time = _parse_timestamp(latest.get("observed_at"))
        if (
            latest_time is None
            or latest_time.utcoffset() != timezone.utc.utcoffset(latest_time)
            or head_metadata_time is None
            or latest_time != head_metadata_time
        ):
            errors.append("{}: `observed_at` must be UTC and equal `head_metadata_observed_at`".format(context))
    source_records = 0
    consumer_records = 0
    workflow_file_total = 0
    caller_total = 0
    definition_total = 0
    file_counts_complete = True
    caller_counts_complete = True
    definition_counts_complete = True
    for index, row in enumerate(rows):
        context = "{} repositories[{}]".format(label, index)
        if not _is_mapping(row):
            errors.append("{} must be an object".format(context))
            continue
        unknown_row_keys = _unknown_keys(row, expected_row_keys)
        if unknown_row_keys:
            errors.append("{}: unsupported or potentially private row field(s): {}".format(context, ", ".join(unknown_row_keys)))
        _check_string_fields(row, ("name", "default_branch", "source_url"), context, errors)
        name = row.get("name")
        if isinstance(name, str):
            if name in names:
                errors.append("{}: duplicate public repository name".format(context))
            names.add(name)
        if row.get("visibility") != "public":
            errors.append("{}: only public repository records may appear in this snapshot".format(context))
        if row.get("role") == "governance_source":
            source_records += 1
        elif row.get("role") == "consumer":
            consumer_records += 1
        else:
            errors.append("{}: role must be governance_source or consumer".format(context))

        sha = row.get("head_sha")
        if not isinstance(sha, str) or not SHA_RE.fullmatch(sha):
            errors.append("{}: `head_sha` must be a full 40-character commit SHA".format(context))
        row_time = _parse_timestamp(row.get("observed_at"))
        if row_time is None:
            errors.append("{}: `observed_at` must be timezone-aware UTC ISO-8601".format(context))
        elif row_time.utcoffset() != timezone.utc.utcoffset(row_time):
            errors.append("{}: `observed_at` must be timezone-aware UTC ISO-8601".format(context))
        elif snapshot_time is not None and (row_time.date() != snapshot_time.date() or row_time > snapshot_time):
            errors.append("{}: row observation is stale or later than the snapshot time".format(context))
        source_url = row.get("source_url")
        try:
            source_parts = urlsplit(source_url) if isinstance(source_url, str) else None
        except ValueError:
            source_parts = None
        expected_tree_path = "/{}/{}/tree/{}".format(organization, name, sha)
        if (
            not _https_url(source_url)
            or source_parts is None
            or source_parts.hostname != "github.com"
            or source_parts.path != expected_tree_path
            or source_parts.query
            or source_parts.fragment
        ):
            errors.append("{}: `source_url` must be an HTTPS tree URL pinned to `head_sha`".format(context))
        if row.get("tree_status") not in {"complete", "partial", "inaccessible"}:
            errors.append("{}: invalid `tree_status`".format(context))

        artifacts = row.get("artifacts")
        if not _is_mapping(artifacts):
            errors.append("{}: `artifacts` must be an object".format(context))
            artifacts = {}
        if set(artifacts) != expected_artifacts:
            errors.append("{}: artifact keys do not match the adoption observation inventory".format(context))
        for artifact_name, artifact in artifacts.items():
            artifact_context = "{} artifacts.{}".format(context, artifact_name)
            if not _is_mapping(artifact):
                errors.append("{} must be an object".format(artifact_context))
                continue
            if _unknown_keys(artifact, {"status", "paths"}):
                errors.append("{}: artifact records may contain only `status` and root `paths`".format(artifact_context))
            status = artifact.get("status")
            paths = artifact.get("paths")
            if status not in allowed_artifact_states:
                errors.append("{} has invalid status".format(artifact_context))
            if not isinstance(paths, list) or any(not _nonempty_string(item) for item in paths):
                errors.append("{} paths must be a list of non-empty repository-relative strings".format(artifact_context))
                continue
            if status == "present" and not paths:
                errors.append("{} marked present has no observed paths".format(artifact_context))
            if status in {"absent", "unknown"} and paths:
                errors.append("{} marked {} includes observed paths".format(artifact_context, status))
            for observed_path in paths:
                if observed_path.startswith("/") or "\\" in observed_path or ".." in Path(observed_path).parts:
                    errors.append("{} contains an unsafe repository path".format(artifact_context))

        nested_paths = row.get("nested_paths")
        if not isinstance(nested_paths, list) or any(not _nonempty_string(item) for item in nested_paths):
            errors.append("{}: `nested_paths` must be a list of repository-relative strings".format(context))
        elif any(item.startswith("/") or "\\" in item or ".." in Path(item).parts for item in nested_paths):
            errors.append("{}: `nested_paths` contains an unsafe repository path".format(context))
        if not isinstance(row.get("local_overrides"), bool):
            errors.append("{}: `local_overrides` must be boolean".format(context))

        audit = row.get("workflow_audit")
        if not _is_mapping(audit):
            errors.append("{}: `workflow_audit` must be an object".format(context))
            audit = {}
        if _unknown_keys(audit, {
            "status", "workflow_file_count", "parse_status", "invalid_yaml_count",
            "shared_workflow_caller_count", "workflow_definition_count",
        }):
            errors.append("{}: unsupported workflow-audit key(s)".format(context))
        if audit.get("status") not in {"inspected", "unknown"}:
            errors.append("{}: invalid workflow audit status".format(context))
        if audit.get("parse_status") not in {"complete", "partial", "unknown"}:
            errors.append("{}: invalid workflow YAML parse status".format(context))
        count_values = {}
        for count_key in ("workflow_file_count", "invalid_yaml_count", "shared_workflow_caller_count", "workflow_definition_count"):
            value = audit.get(count_key)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                errors.append("{}: workflow audit `{}` must be a non-negative integer or null".format(context, count_key))
            count_values[count_key] = value if isinstance(value, int) and not isinstance(value, bool) else None
        if audit.get("status") == "inspected" and count_values["workflow_file_count"] is None:
            errors.append("{}: inspected workflow audit needs a workflow file count".format(context))
        if audit.get("parse_status") == "complete" and count_values["invalid_yaml_count"] != 0:
            errors.append("{}: complete workflow parse must record zero invalid YAML files".format(context))
        if (
            audit.get("status") != "inspected"
            or audit.get("parse_status") != "complete"
            or any(count_values[key] is None for key in (
                "workflow_file_count", "invalid_yaml_count", "shared_workflow_caller_count",
                "workflow_definition_count",
            ))
        ):
            errors.append("{}: workflow audit must be complete with observed counts".format(context))
        if count_values["workflow_file_count"] is None:
            file_counts_complete = False
        else:
            workflow_file_total += count_values["workflow_file_count"]
        if count_values["shared_workflow_caller_count"] is None:
            caller_counts_complete = False
        else:
            caller_total += count_values["shared_workflow_caller_count"]
        if count_values["workflow_definition_count"] is None:
            definition_counts_complete = False
        else:
            definition_total += count_values["workflow_definition_count"]
        workflow_paths = artifacts.get("workflow_files", {})
        if (
            _is_mapping(workflow_paths)
            and isinstance(workflow_paths.get("paths"), list)
            and count_values["workflow_file_count"] is not None
            and workflow_paths.get("status") in {"present", "absent"}
            and count_values["workflow_file_count"] != len(workflow_paths["paths"])
        ):
            errors.append("{}: workflow file count does not join to recorded root workflow paths".format(context))

        settings = row.get("settings")
        if not _is_mapping(settings):
            errors.append("{}: `settings` must be an object".format(context))
            settings = {}
        if _unknown_keys(settings, {
            "branch_protected", "branch_protection_detail", "ruleset_count",
            "label_catalogue", "inherited_profile_effective",
        }):
            errors.append("{}: unsupported settings key(s)".format(context))
        branch_protected = settings.get("branch_protected")
        if branch_protected is not None and not isinstance(branch_protected, bool):
            errors.append("{}: branch protection indicator must be boolean or null".format(context))
        if settings.get("branch_protection_detail") not in {"observed", "access_denied", "unknown"}:
            errors.append("{}: invalid protection-details state".format(context))
        ruleset_count = settings.get("ruleset_count")
        if ruleset_count is not None and (isinstance(ruleset_count, bool) or not isinstance(ruleset_count, int) or ruleset_count < 0):
            errors.append("{}: ruleset count must be a non-negative integer or null".format(context))
        if settings.get("label_catalogue") not in {"observed", "access_denied", "unknown"}:
            errors.append("{}: invalid label-catalogue state".format(context))
        if settings.get("inherited_profile_effective") not in {"verified", "unknown"}:
            errors.append("{}: invalid inherited profile state".format(context))

        expected_adoption = "not_applicable" if row.get("role") == "governance_source" else "not_verified"
        if row.get("adoption_status") != expected_adoption:
            errors.append("{}: adoption status must not infer adoption from file presence".format(context))

    source_names = {
        row.get("name") for row in rows
        if _is_mapping(row) and row.get("role") == "governance_source"
    }
    if source_records != 1 or consumer_records != 14 or source_names != {".github"}:
        errors.append("{}: public rows must contain the .github governance source and 14 consumer records".format(label))
    if len(names) != len(rows):
        errors.append("{}: public repository names are incomplete or duplicated".format(label))
    if latest_head_names != names:
        errors.append("{}: latest-head metadata names must join exactly to the public tree records".format(label))
    if file_counts_complete and workflow_file_total != summary.get("workflow_files_inspected"):
        errors.append("{}: workflow file summary does not join to repository observations".format(label))
    if caller_counts_complete and caller_total != summary.get("shared_workflow_callers"):
        errors.append("{}: shared-workflow caller summary does not join to repository observations".format(label))
    if definition_counts_complete and definition_total != summary.get("workflow_definitions"):
        errors.append("{}: workflow definition summary does not join to repository observations".format(label))
    return errors


def run_validation(root: Path) -> tuple[list[str], dict[str, int]]:
    errors: list[str] = []
    markdown_errors, markdown_stats = validate_markdown_links(root)
    errors.extend(markdown_errors)
    checks = (
        validate_issue_forms(root),
        validate_governance_register(root),
        validate_observation_snapshot(root),
        validate_workflows(root),
        validate_release_template(root),
        validate_pull_request_template(root),
    )
    for check_errors in checks:
        errors.extend(check_errors)
    return errors, markdown_stats


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="repository checkout root (default: detected root)")
    args = parser.parse_args(argv)
    root = args.root.resolve(strict=True)
    errors, stats = run_validation(root)
    if errors:
        for error in errors:
            print("ERROR: " + error, file=sys.stderr)
        print("Governance validation failed: {} error(s).".format(len(errors)), file=sys.stderr)
        return 1
    print(
        "Governance validation passed: issue forms/config, governance JSON joins/states, "
        "dated adoption observation, workflow policy, release/PR template prerequisites; "
        "{} Markdown files, {} supported local links, {} profile asset references.".format(
            stats["markdown_files"], stats["local_links"], stats["profile_assets"]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
