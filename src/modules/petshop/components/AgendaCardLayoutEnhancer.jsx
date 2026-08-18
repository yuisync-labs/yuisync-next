const STYLES = `
  .yuisync-agenda-card-surface .yuisync-card-content {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) !important;
    align-content: start !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-header {
    order: 1 !important;
    min-height: 20px !important;
    margin-bottom: 0 !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-body {
    display: contents !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-transport,
  .yuisync-agenda-card-surface[data-yuisync-motodog='false'] .yuisync-card-transport {
    order: 2 !important;
    display: block !important;
    min-width: 0 !important;
    margin: 0 0 2px !important;
    font-size: 8.5px !important;
    line-height: 1.05 !important;
    font-weight: 800 !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-transport > p:first-child {
    display: flex !important;
    min-width: 0 !important;
    margin: 0 !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-transport > p:not(:first-child) {
    display: none !important;
  }

  .yuisync-agenda-card-surface .yuisync-card-pet { order: 3 !important; }
  .yuisync-agenda-card-surface .yuisync-card-tutor { order: 4 !important; }
  .yuisync-agenda-card-surface .yuisync-card-service { order: 5 !important; }
  .yuisync-agenda-card-surface .yuisync-card-responsible { order: 6 !important; }

  .yuisync-agenda-card-surface .yuisync-card-pet,
  .yuisync-agenda-card-surface .yuisync-card-tutor,
  .yuisync-agenda-card-surface .yuisync-card-service > span:first-child {
    white-space: normal !important;
    overflow-wrap: anywhere !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-density='comfortable'] .yuisync-card-pet,
  .yuisync-agenda-card-surface[data-yuisync-density='comfortable'] .yuisync-card-tutor,
  .yuisync-agenda-card-surface[data-yuisync-density='compact'] .yuisync-card-pet,
  .yuisync-agenda-card-surface[data-yuisync-density='compact'] .yuisync-card-tutor {
    -webkit-line-clamp: 2 !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-density='compact'] .yuisync-card-responsible,
  .yuisync-agenda-card-surface[data-yuisync-density='dense'] .yuisync-card-responsible,
  .yuisync-agenda-card-surface[data-yuisync-density='micro'] .yuisync-card-responsible {
    display: block !important;
    min-width: 0 !important;
    margin-top: 1px !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    font-size: 8.5px !important;
    line-height: 1.05 !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-card-tutor {
    display: block !important;
    overflow: hidden !important;
    white-space: nowrap !important;
    text-overflow: ellipsis !important;
    -webkit-line-clamp: unset !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-card-service {
    grid-template-columns: minmax(0, 1fr) auto !important;
    align-items: start !important;
    gap: 5px !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-card-service > span:first-child {
    grid-column: 1 !important;
    min-width: 0 !important;
    -webkit-line-clamp: 2 !important;
  }

  .yuisync-agenda-card-surface[data-yuisync-card-kind='package'] .yuisync-package-label {
    grid-column: 2 !important;
    display: block !important;
    align-self: start !important;
    width: auto !important;
    max-width: none !important;
    overflow: visible !important;
    white-space: nowrap !important;
  }
`

export function AgendaCardLayoutEnhancer() {
  return <style>{STYLES}</style>
}
