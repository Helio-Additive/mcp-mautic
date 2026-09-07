# Changelog

## 0.2.0

- Changed high-volume contact, segment, campaign, field, activity, and business reads to return compact summaries by default, with `includeRaw: true` available for full Mautic payloads.
- Added `get_segment_summary` for audience counts and optional small contact samples without paging full segments.
- Added `preview_email_send` and dry-run behavior for `send_email` and `send_email_to_segment`.
- Required `confirmSend: true` before live email send handlers post to Mautic.
- Added dry-run-first `bulk_upsert_contacts` for chunked contact create/update workflows.
- Added bounded bulk upsert batching plus optional post-upsert segment and tag assignment.
- Added `find_duplicates` for contact duplicate grouping by normalized field values.
- Added resumable and summary-only duplicate scans.
- Added guarded `merge_contacts` for managed field/tag/segment/company copy into a surviving contact, with optional secondary deletion only when explicitly requested.
- Added `merge_contacts.mergeMode: "native"` to call the authenticated Mautic UI merge flow with CSRF handling.
- Added confirmation gates for contact/segment deletes and high-impact contact, campaign membership, point, stage, tag, DNC, owner, and reply-tracking mutations.
- Added preview-first behavior for SMS, company, company membership, note, tag, category, and contact-field creation or association tools.
- Added email send readiness warnings for unpublished emails, missing direct targets, unresolved direct targets, sampled DNC contacts, possible multi-segment double counting, and optional full direct-contact readiness checks.
- Sanitized Mautic auth/token and top-level MCP error logging to avoid leaking OAuth secrets or authorization headers.
- Changed managed contact merge live mode to report per-operation results and stop before secondary deletion if an earlier operation fails.
- Changed SMS list/stat-like routes and generic email/campaign stats fallbacks to compact output by default, with `includeRaw: true` for full payloads.
- Clamped audited v1 `limit` and `start` pagination inputs before sending requests to Mautic.

## 0.1.20

- Exposed email `language` and `category` fields in `create_email_template` and `update_email`.
- Added email language and category summaries to compact email output so metadata parity audits do not require raw email payloads.

## 0.1.19

- Standardized remaining audited v1 mutation outputs around `success`, `action`, `id`, and an entity summary.
- Normalized older contact, segment, business, advanced, email send/reply, campaign, file upload, and SMS mutation responses.
- Changed Mautic 6 partial-route fallbacks to structured `success: false` responses with reasons and alternatives.
- Consolidated README compatibility notes into one Mautic 6.0.7 section.
- Documented the live-tested state from the audit round.

## 0.1.18

- Added shared pagination metadata for audited v1 list/search tools.
- Standardized core list outputs around `{ pagination, ...items }`.
- Added `start` pagination support to webhook and report list tools.
- Reused the shared pagination helper for campaign contact membership pagination.
- Documented paginated list output behavior for local agent use.

## 0.1.17

- Added compact webhook output for `list_webhooks` and new `get_webhook`.
- Added `update_webhook` and guarded `delete_webhook`.
- Added compact report output for `list_reports` and new `get_report`.
- Added `update_report` and guarded `delete_report`.
- Changed webhook and report creation to default to unpublished unless explicitly requested.
- Changed `upload_file` to default to the Mautic 6-compatible `media` folder.
- Normalized upload, webhook, and report mutation outputs.
- Documented Mautic 6 integration compatibility behavior.
- Added diagnostic response details for webhook/report create failures.
- Live-tested webhook and report create/update/delete with disposable unpublished records.

## 0.1.16

- Added compact asset and landing page output for list/detail tools.
- Added `update_asset` and guarded `delete_asset`.
- Added `get_page`, `update_page`, and guarded `delete_page`.
- Changed `create_asset` and `create_page` to default to unpublished unless explicitly requested.
- Normalized create/update/delete outputs for assets and landing pages.
- Documented Mautic 6 content compatibility behavior.
- Fixed local asset creation to upload filesystem paths through `/files/media/new` before creating the asset.
- Fixed asset creation to send Mautic's documented `file` field instead of `tempName` or `remotePath`.
- Fixed `upload_file` to use `/files/{folder}/new` with multipart upload.

## 0.1.15

- Added compact form output for `list_forms` and `get_form`.
- Added `create_form`, defaulting new forms to unpublished.
- Added `update_form` for form metadata, fields, and actions.
- Added guarded `delete_form` with explicit confirmation.
- Normalized `get_form_submissions` output by default.
- Documented Mautic 6 form compatibility behavior.

## 0.1.14

- Added `update_email` using the Mautic v1 email edit endpoint.
- Added guarded `delete_email` with explicit confirmation.
- Normalized email create/update/delete outputs to avoid dumping large email bodies by default.
- Changed `list_emails` and `get_email` to exclude `customHtml` and `plainText` unless `includeContent: true` is passed.
- Made `get_email_stats` return a clear Mautic 6 compatibility message when `/emails/{id}/stats` is unavailable.
- Documented Mautic 6 email compatibility behavior.

## 0.1.1

- Fixed `get_segment_contacts` for Mautic 6.0.7 by resolving the segment alias and using contact search with `segment:<alias>`.
- Added normalized contact output for `get_contact`, `search_contacts`, and `get_segment_contacts`.
- Added optional field alias filtering for compact contact responses.
- Preserved explicit `0` and `false` query parameters in audited v1 contact, segment, and business tools.
- Switched contact tag add/remove operations to the v1 contact edit endpoint pattern; live verification still requires a disposable test contact.

## 0.1.0

- Established this as Helio's local Mautic MCP fork.
- Documented Mautic 6.0.7 as the tested compatibility target.
- Documented that API v2 / Mautic 7 code should be left untouched unless explicitly required.
- Fixed contact first and last name updates by mapping MCP `firstName` / `lastName` input to Mautic contact field aliases.
