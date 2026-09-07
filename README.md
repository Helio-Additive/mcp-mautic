# Mautic MCP Server

Helio's local Model Context Protocol (MCP) server fork for Mautic. The fork is cloned locally by team members and used directly by Codex and Claude.

Compatibility target: tested with Mautic 6.0.7.

API v2 / Mautic 7 code is preserved from upstream and should be left untouched unless explicitly required.

## Helio Local Workflow

Keep `main` stable. Codex and Claude should point at `main` or a known-good tag.

Use a branch for each fix, run the build before merging, then restart the local MCP process in Codex or Claude.

```bash
npm install
npm run build
```

If `just` is available, the same local checks are:

```bash
just ready
```

After pulling changes, always rebuild and restart the MCP server. Pulling code is not enough if Codex or Claude still has the old `build/index.js` process running.

Example local MCP command:

```json
{
  "command": "node",
  "args": ["/Users/jamesriggleman/code/helio-additive/helio-mautic-MCP/build/index.js"]
}
```

## Versioning

This fork uses lightweight local versioning:

- `0.1.x` for bug fixes.
- `0.2.x` for new tools or behavior.
- Tags such as `local-2026-07-16` or `v0.1.0` mark known-good checkpoints.

See [CHANGELOG.md](CHANGELOG.md) for local compatibility notes.

## Upstream Context

This fork started from a comprehensive Model Context Protocol (MCP) server for Mautic 7 (Columba Edition) marketing automation platform. Supports both v1 (FOSRestBundle) and v2 (API Platform) endpoints with 68 tools.

[![GitHub Stars](https://img.shields.io/github/stars/Cbrown35/mantic-MCP?style=social)](https://github.com/Cbrown35/mantic-MCP/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/Cbrown35/mantic-MCP)](https://github.com/Cbrown35/mantic-MCP/issues)
[![GitHub License](https://img.shields.io/github/license/Cbrown35/mantic-MCP)](https://github.com/Cbrown35/mantic-MCP/blob/main/LICENSE)

## Mautic 6.0.7 Compatibility

Helio tests this fork against Mautic 6.0.7. API v2 / Mautic 7 code remains preserved from upstream unless a change is explicitly required.

- Audited v1 list/search tools return pagination metadata with `total`, `start`, `limit`, `count`, `hasMore`, and `nextStart`.
- Audited v1 mutation tools return `success`, `action`, `id`, and a normalized entity summary such as `contact`, `campaign`, `segment`, `email`, or `file`.
- Large content is excluded by default where it tends to bury agents: nested campaign/contact/segment graphs, email bodies, page HTML, file contents, raw form builder internals, webhook secrets, and heavy report data require `includeContent` or `includeRaw` where available.
- Email send tools are preview-first: use `preview_email_send` or `dryRun: true`, then pass `confirmSend: true` for live sends. Previews include readiness warnings for unpublished emails, missing/unresolved direct targets, sampled DNC contacts, and possible multi-segment double counting. Direct sends can request exhaustive contact ID validation with `requireFullReadinessCheck: true`.
- High-impact contact/audience mutations are preview-first where audited. Live contact delete, segment delete, owner, DNC, segment membership, campaign membership, points, stage, tag, merge, reply-tracking, bulk upsert, SMS creation, company/category/tag/note creation, company membership, contact-field creation, and email send operations require explicit confirmation.
- `bulk_upsert_contacts` supports bounded batch processing and optional post-upsert segment/tag assignment.
- `find_duplicates` supports resumable scans and summary-only output for lower token use.
- Generic email/campaign stats outputs are compact by default, with `includeRaw: true` for full Mautic payloads.
- Mautic 6 does not expose `/emails/{id}/stats`; use `get_email_stats_v6` for aggregate counters and `get_email_graph_stats_v6` for web graph data.
- The campaign trigger route is unavailable on Mautic 6.0.7; `execute_campaign` is guarded and returns a structured unsupported-route response.
- Campaign clone/export/import use managed v1 flows that recreate metadata, sources, events, and canvas settings instead of relying on Mautic 7 import/export routes.
- `update_campaign` is metadata-only. Use managed clone/import for structural event, source, form, or canvas changes.
- Local asset creation uploads filesystem paths through `/files/media/new`, then creates the asset with the uploaded filename. Mautic 6 accepts file uploads to `media` or `images`.
- New forms, assets, pages, webhooks, and reports default to unpublished unless `isPublished: true` is explicitly passed.
- Destructive audited tools require confirmation, such as contact, segment, email, form, asset, page, webhook, report, and non-disposable campaign deletes.

Live-tested during this audit: contact name updates, segment contact fallback search, tag add/remove, segment remove/delete, campaign contact add/remove, campaign clone/export/import with segment/form/email automation, email update/delete/stats fallbacks, form create/update/delete/submissions, asset upload/create/update/delete, page create/update/delete, webhook create/update/delete, report create/update/delete, and paginated list outputs.

## Quick Start

```bash
# Clone and setup the Helio fork
git clone <helio-fork-url>
cd helio-mautic-MCP
npm install

# Configure your Mautic credentials
cp .env.example .env
# Edit .env with your Mautic API credentials

# Build and run
npm run build
```

Then add the server to your MCP configuration and start using natural language commands like:
- "Search for all contacts with gmail in their email"
- "Create a new project to organize my Q1 campaign resources"
- "Clone campaign 5 and export it for staging"
- "Send email template 12 to its assigned segment"

## Upstream v2.0 Notes (Mautic 7 Support)

### Projects (API v2)
Organize marketing resources under a single logical structure using Mautic 7's new API Platform v2 endpoints.
- **list_projects**, **get_project**, **create_project**, **update_project**, **patch_project**, **delete_project**

### Campaign Import/Export
Move complete campaign setups between environments.
- **clone_campaign** - Managed v1 clone that recreates metadata, sources, events, and canvas settings
- **export_campaign** - Managed portable campaign JSON export
- **import_campaign** - Managed portable campaign JSON import

### Campaign Analytics
- **get_campaign_event_details** - Campaign event configuration/details
- **get_campaign_graph_stats** - Campaign graph statistics for date ranges
- **get_campaign_map_stats** - Geographic map statistics
- **get_campaign_email_metrics_v6** - Mautic 6 campaign email sent/read/clicked metrics by weekday or hour
- **get_campaign_map_stats_v6** - Mautic 6 geographic map statistics via authenticated web stats route

### Segment-Based Email Sending
- **send_email_to_segment** - Send email to assigned segments with real-time audience adaptation

### Email Reply Tracking
- **record_email_reply** - Record email replies by tracking hash
- **get_email_graph_stats** - Email graph statistics for date ranges
- **get_email_stats_v6** - Mautic 6 aggregate counters
- **get_email_graph_stats_v6** - Mautic 6 graph statistics via authenticated web stats route

### Deprecation Notice
SMS API classes have been removed in Mautic 7. The `list_sms` and `create_sms` tools include deprecation warnings.

## Features

### Authentication
- OAuth2 authentication with automatic token refresh
- Secure credential management through environment variables
- Dual API support: v1 (FOSRestBundle) and v2 (API Platform)

### Contact Management (14 tools)
- **create_contact** - Create new contacts with custom fields
- **update_contact** - Update existing contact information
- **get_contact** - Retrieve contact details by ID or email
- **search_contacts** - Search contacts with filters and pagination
- **bulk_upsert_contacts** - Dry-run-first chunked contact create/update by an upsert field
- **find_duplicates** - Find likely duplicate contacts by grouping normalized field values
- **merge_contacts** - Dry-run-first contact merge with managed copy mode by default and optional native Mautic UI merge mode
- **get_contact_preferences** - Read contact DNC, frequency rules, owner, tags, segments, and campaigns
- **delete_contact** - Remove contacts from Mautic
- **assign_contact_owner** - Assign or clear a contact owner
- **add_contact_dnc** - Add Do Not Contact status for a contact channel
- **remove_contact_dnc** - Remove Do Not Contact status for a contact channel
- **add_contact_to_segment** - Add contacts to specific segments
- **remove_contact_from_segment** - Remove contacts from specific segments

### Campaign Management (18 tools)
- **list_campaigns** - Get all campaigns with compact output by default
- **get_campaign** - Get campaign information with compact output by default
- **create_campaign** - Create new campaigns
- **update_campaign** - Update campaign metadata and publication state; structural changes are rejected
- **delete_campaign** - Delete campaigns; requires confirmation unless campaign is clearly disposable/test data
- **add_contact_to_campaign** - Add contacts to campaigns
- **remove_contact_from_campaign** - Remove contacts from campaigns
- **create_campaign_with_automation** - Create validated, unpublished-by-default campaigns with full event automation
- **execute_campaign** - Manually execute/trigger campaigns when the trigger route exists; guarded and reports unsupported on Mautic 6.0.7
- **get_campaign_contacts** - Get paginated campaign membership rows, optionally enriched with normalized contact details
- **clone_campaign** - Clone an existing campaign by recreating metadata, sources, events, and canvas settings
- **export_campaign** - Export portable managed campaign JSON for metadata, sources, events, and canvas settings
- **import_campaign** - Import portable managed campaign JSON through the Mautic v1 campaign create flow
- **get_campaign_event_details** - Campaign event configuration/details
- **get_campaign_graph_stats** - Campaign graph statistics (Mautic 7)
- **get_campaign_map_stats** - Campaign geographic stats (Mautic 7)
- **get_campaign_email_metrics_v6** - Campaign email metrics by weekday or hour (Mautic 6)
- **get_campaign_map_stats_v6** - Campaign geographic stats (Mautic 6)

### Email Operations (13 tools)
- **send_email** - Preview or, with `confirmSend: true`, send emails to specific contacts
- **preview_email_send** - Preview direct or segment email send reach without sending
- **list_emails** - Get all email templates and campaigns with optional compact/content output
- **get_email** - Get detailed email information with content excluded by default
- **create_email_template** - Create new email templates with normalized output, including language/category metadata
- **update_email** - Update email metadata/content through the Mautic v1 edit endpoint, including language/category metadata
- **delete_email** - Delete emails with explicit confirmation
- **get_email_stats** - Get email performance statistics when the stats route is available
- **send_email_to_segment** - Preview or, with `confirmSend: true`, send email to assigned segments
- **record_email_reply** - Record email reply by tracking hash (Mautic 7)
- **get_email_graph_stats** - Email graph statistics (Mautic 7)
- **get_email_stats_v6** - Email aggregate counters from the Mautic 6 email detail endpoint
- **get_email_graph_stats_v6** - Email graph statistics via the Mautic 6 web stats route

### Form Management (6 tools)
- **list_forms** - Get forms with optional compact field/action output
- **get_form** - Get form details with optional compact field/action output
- **create_form** - Create Mautic forms through the v1 endpoint, unpublished by default
- **update_form** - Update form metadata, fields, or actions through the v1 edit endpoint
- **delete_form** - Delete forms with explicit confirmation
- **get_form_submissions** - Get normalized form submission data

### Segment Management (7 tools)
- **list_segments** - Get compact contact segment summaries
- **create_segment** - Create new contact segments with filters
- **get_segment** - Get compact contact segment details
- **get_segment_summary** - Get compact segment metadata and audience count without paging the full segment
- **update_segment** - Update contact segment metadata and filters
- **delete_segment** - Delete contact segments
- **get_segment_contacts** - Get contacts in a specific segment

### Content Management (12 tools)
- **list_assets** - Get assets with optional compact output
- **get_asset** - Get asset details by ID with optional compact output
- **create_asset** - Create new assets (local or remote), unpublished by default
- **update_asset** - Update asset metadata through the v1 edit endpoint
- **delete_asset** - Delete assets with explicit confirmation
- **list_pages** - Get landing pages with optional compact/content output
- **get_page** - Get landing page details by ID
- **create_page** - Create new landing pages, unpublished by default
- **update_page** - Update landing page metadata/content through the v1 edit endpoint
- **delete_page** - Delete landing pages with explicit confirmation
- **list_sms** - Get all SMS templates [DEPRECATED in Mautic 7]
- **create_sms** - Create SMS templates [DEPRECATED in Mautic 7]

### Business Entities (11 tools)
- **list_companies** - Get all companies
- **create_company** - Create new companies
- **add_contact_to_company** - Associate contacts with companies
- **create_note** - Add notes to contacts or companies
- **get_contact_notes** - Get all notes for a contact
- **list_tags** - Get all available tags
- **create_tag** - Create new tags
- **add_contact_tags** - Add tags to contacts
- **remove_contact_tags** - Remove tags from contacts
- **list_categories** - Get all categories
- **create_category** - Create new categories

### Advanced Features (7 tools)
- **add_contact_points** - Add points to contacts
- **subtract_contact_points** - Subtract points from contacts
- **list_stages** - Get all lifecycle stages
- **change_contact_stage** - Change contact's lifecycle stage
- **list_contact_fields** - Get all contact custom fields
- **create_contact_field** - Create new contact custom fields
- **get_contact_activity** - Get contact interaction history

### Integration & Automation (11 tools)
- **list_webhooks** - Get webhooks with optional compact output
- **get_webhook** - Get webhook details by ID
- **create_webhook** - Create new webhooks, unpublished by default
- **update_webhook** - Update webhook metadata through the v1 edit endpoint
- **delete_webhook** - Delete webhooks with explicit confirmation
- **upload_file** - Upload local files to Mautic `media` or `images`
- **list_reports** - Get reports with optional compact output
- **get_report** - Get report details by ID
- **create_report** - Create custom reports, unpublished by default
- **update_report** - Update report metadata through the v1 edit endpoint
- **delete_report** - Delete reports with explicit confirmation

### Project Management - API v2 (6 tools, Mautic 7)
- **list_projects** - List all projects
- **get_project** - Get project details
- **create_project** - Create a new project
- **update_project** - Fully update an existing project
- **patch_project** - Partially update a project
- **delete_project** - Delete a project

## Installation

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Access to a Mautic instance with API credentials. Helio tests this fork against Mautic 6.0.7.

### Setup

1. **Clone the repository:**
   ```bash
   git clone <helio-fork-url>
   cd helio-mautic-MCP
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your Mautic API credentials:
   ```env
   MAUTIC_BASE_URL=https://your-mautic-instance.com/api/
   MAUTIC_CLIENT_ID=your_client_id_here
   MAUTIC_CLIENT_SECRET=your_client_secret_here
   MAUTIC_TOKEN_ENDPOINT=https://your-mautic-instance.com/oauth/v2/token
   ```

4. **Build the server:**
   ```bash
   npm run build
   ```

5. **Configure MCP settings:**
   Add the server to your MCP configuration file:
   ```json
   {
     "mcpServers": {
       "mautic-server": {
         "command": "node",
         "args": ["/path/to/mautic-server/build/index.js"],
         "env": {
           "MAUTIC_BASE_URL": "https://your-mautic-instance.com/api/",
           "MAUTIC_CLIENT_ID": "your_client_id",
           "MAUTIC_CLIENT_SECRET": "your_client_secret",
           "MAUTIC_TOKEN_ENDPOINT": "https://your-mautic-instance.com/oauth/v2/token"
         },
         "disabled": false,
         "autoApprove": []
       }
     }
   }
   ```

## Architecture

### Dual API Support

Mautic 7 has a three-tier API architecture:

| Layer | Purpose | Endpoints |
|-------|---------|-----------|
| **API Platform 4.x** | New v2 REST endpoints (JSON-LD/Hydra) | `/api/v2/projects` |
| **FOSRestBundle** | Existing v1 endpoints | `/api/contacts`, `/api/campaigns`, etc. |
| **FOSOAuthServerBundle** | OAuth2 authentication | `/oauth/v2/token` |

The MCP server automatically manages both API versions. v1 endpoints use the configured `MAUTIC_BASE_URL` directly, while v2 endpoints are derived automatically.

### Project Structure

```
src/
├── index.ts              # Entry point: server setup and startup
├── types/                # TypeScript interfaces
│   ├── common.ts         # Shared types (OAuth2Token, ToolResult, etc.)
│   ├── contacts.ts       # MauticContact interface
│   ├── campaigns.ts      # MauticCampaign interface
│   ├── emails.ts         # MauticEmail interface
│   ├── forms.ts          # MauticForm interface
│   ├── segments.ts       # MauticSegment interface
│   └── projects.ts       # MauticProject interface (Mautic 7)
├── api/
│   └── client.ts         # Dual API client (v1 + v2) with OAuth2
└── tools/
    ├── index.ts           # Tool registry and dispatch
    ├── contacts.ts        # Contact tools
    ├── campaigns.ts       # Campaign tools (includes Mautic 7 additions)
    ├── emails.ts          # Email tools (includes Mautic 7 additions)
    ├── forms.ts           # Form tools
    ├── segments.ts        # Segment tools
    ├── projects.ts        # Project tools (Mautic 7 API v2)
    ├── content.ts         # Asset, page, and SMS tools
    ├── business.ts        # Company, note, tag, and category tools
    ├── advanced.ts        # Points, stages, fields, and activity tools
    └── integration.ts     # Webhook, file, and report tools
```

## Configuration

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MAUTIC_BASE_URL` | Your Mautic API base URL | `https://your-mautic.com/api/` |
| `MAUTIC_CLIENT_ID` | OAuth2 Client ID | `1_abc123...` |
| `MAUTIC_CLIENT_SECRET` | OAuth2 Client Secret | `secret123...` |
| `MAUTIC_TOKEN_ENDPOINT` | OAuth2 Token Endpoint | `https://your-mautic.com/oauth/v2/token` |

### Obtaining Mautic API Credentials

1. Log into your Mautic instance as an administrator
2. Go to Settings > Configuration > API Settings
3. Enable API access
4. Go to Settings > API Credentials
5. Create a new API credential with OAuth2 authorization
6. Note down the Client ID and Client Secret

## Error Handling

The server includes comprehensive error handling:
- Automatic OAuth2 token refresh
- Detailed error messages from both v1 and v2 API formats
- Graceful handling of authentication failures
- Retry logic for transient errors

## Security

- All credentials are stored as environment variables
- OAuth2 tokens are automatically refreshed
- No sensitive data is logged or exposed
- Secure HTTPS communication with Mautic API

## Development

To modify or extend the server:

1. Edit the source code in the `src/` directory
2. Add new tools by creating a file in `src/tools/` and importing it in `src/tools/index.ts`
3. Build the server: `npm run build`
4. Test with the MCP Inspector: `npm run inspector`

## Contributing

We welcome contributions! Please see the repository for contribution guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) v1.26.0
- Integrates with [Mautic 7](https://www.mautic.org/) (Columba Edition)
