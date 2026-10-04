# Kubernetes Agent Explainer

An interactive static website explaining a proposed Kubernetes incident-response agent: investigate an alert, propose a GitOps change, wait for human approval, and verify recovery.

The walkthrough includes memory-limit regression, invalid image tag, and missing configuration scenarios, plus architecture, operational boundaries, a build plan, and proposed evaluation criteria.

All incident data and outcomes are illustrative. No Kubernetes cluster or AI service is connected.

## Run locally

Requires Python 3. No dependencies or build step are needed.

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000.

## Files

- `dist/index.html` — page content and structure
- `dist/styles.css` — responsive layout and light/dark themes
- `dist/app.js` — interactive scenario walkthrough and theme controls
- `.openai/hosting.json` — Sites hosting configuration

To host elsewhere, serve the contents of `dist/` as a static website.
