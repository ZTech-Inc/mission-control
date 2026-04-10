(() => {
  try {
    const theme = localStorage.getItem('theme') || 'void'
    const lightThemes = ['light', 'paper']
    if (!lightThemes.includes(theme)) {
      document.documentElement.classList.add('dark')
    }
  } catch {
    // Ignore storage access errors and keep default theme.
  }
})()
