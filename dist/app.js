'use strict';
const stages = ['Alert', 'Inspect', 'Hypothesize', 'Test', 'Propose', 'Approve', 'Verify'];
const cases = {
  memory: {
    alert:'KubePodCrashLooping\nnamespace: agent-lab\nworkload: orders-api\nobserved: 6 restarts in 10 minutes\nlast rollout: 09:42',
    observations:'[E1] Last termination: OOMKilled (exit 137)\n[E2] Memory limit: 128Mi\n[E3] Git diff: limit changed from 512Mi to 128Mi\n[E4] Application image digest unchanged',
    hypothesis:'Likely: the new memory limit is below the workload’s normal demand.\nAlternative: a memory leak or a changed traffic pattern.\nNeeded: memory history, traffic, and node-pressure evidence.',
    test:'[E5] Before change: working set around 220Mi\n[E6] Traffic stayed near the pre-rollout baseline\n[E7] Node MemoryPressure: False\n[E8] Terminations began after the limit change',
    inference:'The recent limit change is the best-supported explanation. OOMKilled alone would not justify a memory increase; the unchanged image, stable traffic, and previous usage make this a specific regression.',
    patch:'File: apps/orders/deployment.yaml\n\n resources:\n   limits:\n-    memory: 128Mi\n+    memory: 512Mi\n\nRecovery plan: revert this change if health degrades.',
    proposal:'Restore the previous limit rather than invent a new value. Include E1–E8, manifest validation, a resource-capacity check, and a post-deployment observation window in the proposed PR.',
    success:'[V1] Deployment rollout: complete\n[V2] Pods ready: 2/2\n[V3] New restarts during 5-minute window: 0\n[V4] GET /health: 200; order smoke test: passed\n[V5] Memory remained below restored limit',
    failed:'[V1] Deployment rollout: complete\n[V2] Pods ready: 1/2\n[V3] New OOM terminations: 3\n[V4] Order smoke test: failed intermittently\n[V5] Memory continued rising after the change'
  },
  image: {
    alert:'KubeDeploymentReplicasMismatch\nnamespace: agent-lab\nworkload: orders-api\nready replicas: 0/2\nlast rollout: 10:15',
    observations:'[E1] Waiting reason: ImagePullBackOff\n[E2] Registry response: manifest unknown\n[E3] Git diff: image tag v1.4.2 changed to v1.4.22\n[E4] Previous digest recorded in deployment history',
    hypothesis:'Likely: the newly configured image tag does not exist.\nAlternatives: registry authentication or availability failure.\nNeeded: artifact existence and previous-image availability.',
    test:'[E5] v1.4.22: no manifest found in registry\n[E6] Previous immutable digest: manifest available\n[E7] Registry connectivity check: passed\n[E8] CI artifact record: v1.4.2 was published',
    inference:'The missing artifact explains the pull failure. The registry is reachable and the known prior digest is available, so focus on the deployment’s image reference.',
    patch:'File: apps/orders/deployment.yaml\n\n containers:\n   - name: orders-api\n-    image: registry.example/orders:v1.4.22\n+    image: registry.example/orders@sha256:<verified-prior-digest>\n\nIllustrative diff; a real PR must contain the full digest.',
    proposal:'Propose the verified prior digest. Check compatibility before reverting an application release, and attach the registry and CI evidence. Never guess an image digest.',
    success:'[V1] Deployment rollout: complete\n[V2] Pods ready: 2/2\n[V3] Running image digest matches approved PR\n[V4] GET /health: 200; order smoke test: passed\n[V5] No new image-pull failures in 5 minutes',
    failed:'[V1] Image pulled successfully\n[V2] Pods ready: 0/2\n[V3] Readiness probe: failed\n[V4] Order smoke test: failed\n[V5] New application error requires investigation'
  },
  config: {
    alert:'KubePodCrashLooping\nnamespace: agent-lab\nworkload: orders-api\nready replicas: 0/2\nlast rollout: 11:03',
    observations:'[E1] Previous log: required DB_HOST missing\n[E2] Container termination: Error (exit 1)\n[E3] Git diff: removed configMapKeyRef for DB_HOST\n[E4] ConfigMap orders-config still contains db-host',
    hypothesis:'Likely: the deployment no longer passes its required database host.\nAlternative: the reference exists but points to the wrong key.\nNeeded: current manifest and dependency health.',
    test:'[E5] Current pod specification: DB_HOST absent\n[E6] Prior manifest: DB_HOST references orders-config/db-host\n[E7] Database service endpoints: present\n[E8] Database health check: passed',
    inference:'The startup error and removed environment mapping agree. The database is healthy, so restore the missing configuration reference without retrieving database credentials.',
    patch:'File: apps/orders/deployment.yaml\n\n env:\n+  - name: DB_HOST\n+    valueFrom:\n+      configMapKeyRef:\n+        name: orders-config\n+        key: db-host\n\nNo Secret values belong in the patch or incident report.',
    proposal:'Restore the previous ConfigMap reference. Validate the key exists, avoid unrelated manifest changes, and require an application-level database smoke test after deployment.',
    success:'[V1] Deployment rollout: complete\n[V2] Pods ready: 2/2\n[V3] Startup log: configuration loaded\n[V4] Create/read test order: passed\n[V5] No restarts during 5-minute window',
    failed:'[V1] Startup configuration loaded\n[V2] Readiness: failed\n[V3] Database connection: timed out\n[V4] Create/read test order: failed\n[V5] Configuration restoration did not restore service'
  }
};
let stage = 0;
let approved = false;
let rejected = false;
let incomplete = false;
let verifyFailure = false;
const $ = id => document.getElementById(id);
const set = (id, value) => { $(id).textContent = value; };
function branchButton(label, onClick, primary = false) {
  const button = document.createElement('button');
  button.className = 'button ' + (primary ? 'primary' : 'secondary');
  button.textContent = label;
  button.addEventListener('click', onClick);
  $('branch-controls').append(button);
}
function render() {
  const item = cases[$('scenario').value];
  $('step-nav').replaceChildren();
  stages.forEach((name, index) => {
    const button = document.createElement('button');
    button.className = 'step-button' + (index === stage ? ' active' : '');
    button.setAttribute('aria-current', index === stage ? 'step' : 'false');
    const number = document.createElement('span'); number.textContent = String(index + 1).padStart(2, '0');
    button.append(number, document.createTextNode(name));
    button.addEventListener('click', () => { stage = index; render(); });
    $('step-nav').append(button);
  });
  let view;
  if(stage === 0) view = ['Scope the incident', 'An alert starts the workflow. Record the affected service and time range, group duplicates, and create an incident ID.', 'Alert payload', 'receive_alert', item.alert, 'Begin with a scoped incident. An alert signals a symptom; it does not establish the root cause.', 'Investigating'];
  if(stage === 1) view = ['Inspect the workload', 'Read pod status, recent events, previous container logs, and the latest deployment change. Keep each result attached to this incident.', 'First observations', 'get_pod_state + get_git_diff', item.observations, 'Correlate runtime symptoms with configuration changes. Preserve competing explanations rather than immediately choosing a fix.', 'Investigating'];
  if(stage === 2) view = ['Form a testable hypothesis', 'State the likely cause and at least one credible alternative. Decide which observation would distinguish them.', 'Working hypotheses', 'agent reasoning', item.hypothesis, 'Ask for targeted evidence that can challenge the diagnosis. A plausible explanation still needs support.', 'Investigating'];
  if(stage === 3) view = incomplete ? ['Stop when evidence is missing', 'A tool failure leaves a required part of the hypothesis untested. The workflow must preserve that uncertainty.', 'Incomplete evidence', 'tool timeout', '[E5] Evidence query timed out\n[E6] Required corroborating observation unavailable\nBudget: maximum investigation calls reached\nNo supported remediation established', 'Escalate with the observations already gathered and the unanswered question. Do not generate a patch from an untested assumption.', 'Escalated'] : ['Test the explanation', 'Use focused tool calls to check the hypothesis. Evidence should cover more than the original error message.', 'Corroborating observations', 'query_metrics + inspect_dependencies', item.test, item.inference, 'Evidence gathered'];
  if(stage === 4) view = incomplete ? ['No patch without evidence', 'The investigation did not establish a supported remediation. A human receives the evidence and missing checks.', 'Escalation record', 'incident report', 'status: needs_operator\nreason: insufficient evidence\nproposed change: none\nattached: observations, tool error, unresolved hypothesis', 'A useful agent can abstain. Escalation is the correct outcome for this branch.', 'Escalated'] : ['Prepare a reviewable fix', 'Prepare a minimal configuration change with evidence, validation, expected outcome, and a recovery plan.', 'Proposed manifest diff', 'prepare_patch', item.patch, item.proposal, 'Proposal ready'];
  if(stage === 5) view = incomplete ? ['Operator handoff required', 'There is no supported change to approve. Continue the investigation with an operator or obtain the missing evidence.', 'Handoff', 'incident state', 'approval: not requested\ndeployment: not started\nincident: unresolved', 'Resume only after the missing evidence is obtained. This branch cannot claim recovery.', 'Escalated'] : ['Pause for approval', 'The real workflow would open a PR and persist its approval checkpoint. The controls below illustrate the decision; they do not change Git or Kubernetes.', 'Review checkpoint', 'Git pull request', approved ? 'review: approved in this simulation\nmerge: illustrated\nArgo CD: reconcile approved Git state\nnext: verify application health' : 'review: awaiting operator\nchange: scoped to orders-api manifest\nevidence: attached\nhealth checks: defined\ndeployment: not started', approved ? 'Approval permits deployment; it does not prove success. Next, inspect the actual outcome.' : 'Wait for review. If the proposal is rejected, keep the incident unresolved and hand off the evidence.', approved ? 'Approved' : 'Awaiting approval'];
  if(stage === 6) view = incomplete ? ['Unresolved: evidence missing', 'The workflow ended in escalation. No change was made, and recovery was not established.', 'Outcome', 'incident report', 'status: unresolved\nresult: insufficient evidence\nchanges deployed: none\nnext owner: operator', 'Report the incomplete investigation honestly. Keep the evidence available for the next person.', 'Escalated'] : !approved ? ['Approval is still pending', 'Verification of a proposed change can only begin after approval and deployment.', 'Workflow checkpoint', 'incident state', 'approval: pending\ndeployment: not started\npost-change verification: not available', 'Return to the approval stage. No simulated deployment has been authorized yet.', 'Awaiting approval'] : verifyFailure ? ['Deployment finished. Recovery did not.', 'The rollout completed, but application health checks failed. Preserve the evidence and reopen the investigation.', 'Failed verification', 'rollout_status + health_checks', item.failed, 'Do not close the incident. Escalate, investigate the new evidence, and propose a reviewed Git revert if warranted.', 'Recovery failed'] : ['Verify recovery, then close', 'Compare post-change health against a defined observation window. A successful rollout alone is insufficient.', 'Post-deployment checks', 'rollout_status + health_checks', item.success, 'The example passes its recovery checks. Attach the observations, change reference, timings, and remaining limitations to the incident report.', 'Recovered in simulation'];
  if(rejected && !incomplete && (stage === 5 || stage === 6)) view = ['Proposal rejected: hand off', 'The operator rejected the proposed change. Preserve the rejection reason and continue investigation with an operator.', 'Review outcome', 'incident state', 'review: rejected\ndeployment: not started\nincident: unresolved\nnext: operator investigation', 'No change is deployed. A rejection is an unresolved outcome, not permission to try another write action.', 'Escalated'];
  set('step-counter', 'Stage ' + (stage + 1) + ' of 7');
  set('stage-title', view[0]);set('stage-description', view[1]);set('evidence-title', view[2]);set('tool-name', view[3]);set('evidence', view[4]);set('decision', view[5]);set('stage-state', view[6]);
  $('stage-state').className = 'stage-state' + (view[6] === 'Recovered in simulation' ? ' success' : /Escalated|failed|Awaiting/.test(view[6]) ? ' warning' : '');
  $('branch-controls').replaceChildren();
  if(stage === 3) branchButton(incomplete ? 'Restore the example evidence' : 'What if evidence is missing?', () => {incomplete = !incomplete;approved = false;rejected=false;verifyFailure = false;render();});
  if(stage === 5 && !incomplete) {
    branchButton(approved ? 'Reset approval' : 'Approve in simulation', () => {approved = !approved;rejected=false;verifyFailure = false;render();}, true);
    branchButton('Reject and escalate', () => {approved = false;rejected=true;render();});
  }
  if(stage === 6 && approved && !incomplete) branchButton(verifyFailure ? 'Show successful checks' : 'What if verification fails?', () => {verifyFailure = !verifyFailure;render();});
  if(stage === 6 && !approved && !incomplete) branchButton('Go to approval', () => {stage = 5;render();},true);
  $('previous').disabled = stage === 0;
  set('progress-text', 'Evidence → decision → next action');
  $('next').textContent = stage === 6 ? 'Restart walkthrough' : 'Next stage';
}
$('scenario').addEventListener('change', () => {stage=0;approved=false;rejected=false;incomplete=false;verifyFailure=false;render();});
$('previous').addEventListener('click', () => {stage=Math.max(0,stage-1);render();});
$('next').addEventListener('click', () => {if(stage===6){stage=0;approved=false;rejected=false;incomplete=false;verifyFailure=false;}else{stage++;}render();});
render();
