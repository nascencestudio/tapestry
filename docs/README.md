# Tapestry documentation

Start with [`../CLAUDE.md`](../CLAUDE.md) for the project brief and current status.

## Understand the system

- [Architecture](architecture.md): the pieces and how a page goes from JSON to HTML.
- [Data model](data-model.md): the stored document format (normative spec).
- [Security](security.md): threat model, defenses, and supply-chain policy.
- [Admin bar and safe page loading](admin-bar.md): `getPage()`, `<AdminBar>`, setup and caveats.

## Plan and history

- [Roadmap](roadmap.md): phases, milestones, and what "done" means for each.
- [Devlog](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/devlog.md): chronological log of every work session.
- [Known issues](known-issues.md): upstream bugs, workarounds, open questions.
- [Decisions](decisions/README.md): architecture decision records (ADRs).

## Guides

- [Contributing and development](guides/development.md): the repositories, building and testing the plugin, the editor tour.
- [Deployment](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/guides/deployment.md): Docker + Caddy (in the playground repository).
- [Defining components](guides/defining-components.md): `defineComponent()` reference.

## Research

- [StudioCMS internals](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/research/studiocms-internals.md): verified behavior of the plugin API, renderer pipeline, and component registry.
- [Drupal Canvas](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/research/drupal-canvas.md): what we're emulating, and the feature map.
