export function createShutdown ({
  server,
  stopManaged = () => {},
  stopWidgets,
  getSessions,
  log,
  exit
}) {
  let stopping
  return function shutdown () {
    if (stopping) return stopping
    stopping = (async () => {
      const tasks = [
        () => server.close(),
        stopManaged,
        stopWidgets,
        ...getSessions().map(session => () => session.kill())
      ]
      const results = await Promise.allSettled(tasks.map(async stop => stop()))
      const failures = results.filter(result => result.status === 'rejected')
      for (const failure of failures) {
        log.error('Failed to stop Web application resource:', failure.reason)
      }
      exit(failures.length ? 1 : 0)
    })()
    return stopping
  }
}
