# Flash Report Custom AirSaas - POC

## Specification Document

**Version:** 1.0
**Date:** January 2025

---

## Summary

This project automates the generation of PowerPoint portfolio reports from AirSaas project data.

We will use projects from the SmartView "Projets Vitaux CODIR":
https://app.airsaas.io/space/aqme-corp-/projects/portfolio/projets-vitaux-codir_f67bb94f-464e-44e1-88bc-101bccaed640

Reference PPT template (Systra):
https://docs.google.com/presentation/d/1pqRmhD7FrRMjb-3Qxudi_GxcwydhWhEW/edit

To validate this approach, we will build a POC using a Claude Code project connected to a GitHub repository. This POC will test whether the workflow works well and compare two different PPT generation methods: Gamma API (AI-powered design) and python-pptx (programmatic control).

The workflow enables users to fetch project data from the AirSaas API, map data fields to a PPT template through an interactive conversation, and generate presentations using either engine.

The user provides a reference PPT template that defines the desired slide structure. Claude Code analyzes this template during the mapping phase to understand which slides are needed per project and what data populates each placeholder. The number and type of slides per project depends entirely on the template provided.

Project IDs must be configured manually since AirSaas does not expose an API endpoint for SmartView project lists. The generated PPT contains a summary slide followed by project-specific slides based on the template structure, with a final slide listing any fields that could not be populated.

---

## 1. User Flows

### 1.1 Initial Setup (One-time)

```
USER                                    CLAUDE CODE
─────────────────────────────────────────────────────────────
1. Create GitHub repo
   "flash-report-custom-airsaas-poc"

2. Connect Claude Code to repo

3. Ask Claude Code to initialize       → Creates folder structure
   project structure                     Creates config files
                                         Creates CLAUDE.md

4. Add credentials to .env
   - AIRSAAS_API_KEY
   - GAMMA_API_KEY

5. Add project IDs to
   config/projects.json

6. Run /mapping                        → Interactive conversation
   Answer Claude's questions             Maps AirSaas fields → PPT fields
   about field correspondences           Saves mapping.json
                                         Updates MISSING_FIELDS.md
```

### 1.2 Regular Usage (Each report generation)

```
USER                                    CLAUDE CODE
─────────────────────────────────────────────────────────────
1. /fetch                              → Calls AirSaas API
                                         Fetches all project data
                                         Saves to data/{date}_projects.json

2. /ppt-gamma                          → Reads fetched data
   OR /ppt-skill                         Applies mapping
                                         Generates PPT
                                         Saves to outputs/{date}_portfolio.pptx
                                         Lists unfilled fields

   (Alternative: /ppt-all does both steps)
```

### 1.3 Maintenance

```
USER                                    CLAUDE CODE
─────────────────────────────────────────────────────────────
/config show                           → Displays current configuration

/config projects                       → Edit project list

/mapping                               → Re-run mapping conversation
                                         (if template changes or new fields needed)
```

---

## 2. Commands Reference

| Command | Action | Input | Output |
|---------|--------|-------|--------|
| `/fetch` | Fetch AirSaas data | config/projects.json | data/{date}_projects.json |
| `/mapping` | Interactive field mapping | Template analysis + user answers | config/mapping.json |
| `/ppt-gamma` | Generate PPT via Gamma API | Fetched data + mapping | outputs/{date}_portfolio_gamma.pptx |
| `/ppt-skill` | Generate PPT via python-pptx | Fetched data + mapping | outputs/{date}_portfolio_skill.pptx |
| `/ppt-all` | Fetch + Generate | All above | All above |
| `/config` | View/edit configuration | - | Display or prompt |

---

## 3. Repository Structure

```
flash-report-custom-airsaas-poc/
├── CLAUDE.md                    # Instructions for Claude Code
├── README.md                    # Project documentation
├── SPEC.md                      # This specification document
├── .gitignore
├── .env.example
├── .env                         # Credentials (gitignored)
│
├── config/
│   ├── projects.json            # Project IDs to export
│   └── mapping.json             # Field mapping AirSaas → PPT
│
├── templates/
│   └── ProjectCardAndFollowUp.pptx   # Reference template
│
├── data/
│   └── {date}_projects.json     # Fetched data cache
│
├── outputs/
│   └── {date}_portfolio.pptx    # Generated presentations
│
├── tracking/
│   ├── MISSING_FIELDS.md        # API fields not available
│   └── CLAUDE_ERRORS.md         # Errors log to avoid repeating
│
└── scripts/
    └── airsaas_fetcher.gs       # Google Apps Script reference
```

---

## 4. Configuration Files

### 4.1 .env

| Variable | Description |
|----------|-------------|
| `AIRSAAS_API_KEY` | AirSaas API key |
| `AIRSAAS_BASE_URL` | https://api.airsaas.io/v1 |
| `GAMMA_API_KEY` | Gamma API key (sk-gamma-xxx) |
| `GAMMA_BASE_URL` | https://public-api.gamma.app/v1.0 |

### 4.2 projects.json

| Field | Description |
|-------|-------------|
| `workspace` | Workspace slug (e.g., "aqme-corp-") |
| `projects[]` | Array of project objects with `id`, `short_id`, `name` |

Note: No API endpoint exists for SmartView project lists. IDs must be added manually.

### 4.3 mapping.json

Structure per slide type:
- Field name → AirSaas source path
- Transform function (if needed)
- Status: "ok", "missing" (not in API), or "manual" (user provides)

---

## 5. PPT Output Structure

### 5.1 Slide Sequence

| Slide | Content |
|-------|---------|
| 1 | **Summary** - List of all projects with mood/status |
| 2 to N | **Project slides** - Structure defined by template, repeated for each project |
| Last | **Data Notes** - List of unfilled fields |

### 5.2 Per-Project Slides

The number and content of slides per project is defined by the reference template. Claude Code analyzes the template during the `/mapping` phase and generates the same slide structure for each project.

Example based on current template (3 slides per project):

| Slide | Content |
|-------|---------|
| **Card** | Name, Budget, Achievements, Status, Mood, Risk, Date |
| **Progress** | Completion %, KPIs |
| **Planning** | Milestones timeline, Team efforts table |

This structure will adapt if a different template is provided.

### 5.3 Missing Data Handling

- Empty placeholder remains visible (not "N/A" or error message)
- Last slide lists all fields that could not be populated

---

## 6. Mapping Process

### 6.1 Interactive Flow

1. Claude analyzes template structure
2. Claude lists available AirSaas fields
3. For each PPT placeholder:
   - Claude proposes a match (if confident)
   - User confirms or specifies correct field
   - If no match exists → marked as "missing" or "manual"
4. Result saved to mapping.json
5. Missing API fields logged to MISSING_FIELDS.md

### 6.2 Known Missing Fields (from API analysis)

| Field | Reason |
|-------|--------|
| Mood comment | API returns code only, no text |
| Decision result | Not exposed when status is final |
| Completion % | No direct field (calculate from milestones?) |
| EAC budget | Not in API |
| Deployment area | Not identified |
| End users (actual/target) | Not identified |

---

## 7. PPT Generation Engines

### 7.1 Option A: Gamma API

- Input: Structured markdown text with `\n---\n` slide breaks
- Output: Designed presentation (Gamma's AI styling)
- Export: PPTX download via API
- Pros: Better design, faster to implement
- Cons: Less control over exact layout

### 7.2 Option B: python-pptx (Skill)

- Input: Fetched data + mapping
- Output: Programmatically generated PPTX
- Pros: Full control, matches template exactly
- Cons: More development effort

Both options available. User chooses per generation.

---

## 8. API References

### 8.1 AirSaas API

| Endpoint | Data |
|----------|------|
| `GET /projects/{id}/` | Project info (expand: owner, program, goals, teams) |
| `GET /projects/{id}/members/` | Project members |
| `GET /projects/{id}/efforts/` | Team efforts |
| `GET /projects/{id}/milestones/` | Milestones |
| `GET /decisions/` | Decisions (filter by project) |
| `GET /attention_points/` | Attention points (filter by project) |
| `GET /projects/{id}/budget_lines/` | Budget lines |
| `GET /projects/{id}/budget_values/` | Budget values |
| `GET /projects_moods/` | Available moods/weather |
| `GET /projects_statuses/` | Available statuses |
| `GET /projects_risks/` | Available risks |

Auth: `Authorization: Api-Key {key}`
Pagination: `page`, `page_size` (100), follow `next`

### 8.2 Gamma API

| Endpoint | Action |
|----------|--------|
| `POST /generations` | Create presentation |
| `GET /generations/{id}` | Check status / get download URL |

Auth: `X-API-KEY: {key}`
Export: `exportOptions: { pptx: true }`

---

## 9. Tracking Files

### 9.1 MISSING_FIELDS.md

Log of all AirSaas fields needed but not available in API.

| Content | Purpose |
|---------|---------|
| Field name | What's missing |
| PPT location | Where it should appear |
| Workaround | Alternative if any |

---

## 10. Acceptance Criteria

### Setup
- [ ] Repo created with correct structure
- [ ] CLAUDE.md enables all commands
- [ ] .env properly configured
- [ ] projects.json populated with target project IDs

### /fetch
- [ ] Authenticates with AirSaas API
- [ ] Fetches complete data for each project
- [ ] Saves JSON with date prefix
- [ ] Reports errors clearly

### /mapping
- [ ] Analyzes template
- [ ] Proposes field matches
- [ ] Saves mapping.json
- [ ] Logs missing fields

### /ppt-gamma
- [ ] Generates structured input text
- [ ] Calls Gamma API
- [ ] Downloads and saves PPTX
- [ ] Lists unfilled fields

### /ppt-skill
- [ ] Generates PPTX with python-pptx
- [ ] Creates correct slide sequence
- [ ] Handles missing data with empty placeholders

---

## 11. Appendix: Reference Files

### A. Google Apps Script Example

File: `scripts/airsaas_fetcher.gs`

A complete Google Apps Script that fetches ALL information for a single project from AirSaas API. Can be used as:
- Reference for API structure
- Standalone tool in Google Sheets
- Basis for understanding data model

Features:
- Fetches: project, members, efforts, milestones, decisions, attention points, budget
- Fetches: all workspace references (moods, statuses, risks, teams, users)
- Resolves codes to human-readable labels
- Exports to Google Sheets with formatted tabs

### B. Template Reference

File: `templates/ProjectCardAndFollowUp.pptx`

Example presentation showing desired output format. Used as reference for:
- Slide structure (3 slides per project)
- Design style to emulate
- Field placeholders to map

---

*End of Specification*
