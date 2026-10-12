<script lang="ts">
  // Placeholder until stage 3 (overview): shows whether the backend can reach Immich.
  let immich = $state('…');
  fetch('/api/health?wake=1').then(r => r.json()).then(h => { immich = h.immich; }, () => { immich = 'backend unreachable'; });
</script>

<main>Immich Viewer — Immich: <span class="mono">{immich}</span></main>

<style>
  main { padding: 48px 24px; }
  .mono { font-family: var(--f-mono); }
</style>
