import { useLayoutEffect, useRef } from 'react'

const modalStack = []
const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export function useModalDialog(onClose) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const previousFocus = document.activeElement
    const appRoot = document.getElementById('root')
    const wasInert = appRoot?.inert
    if (appRoot && !appRoot.contains(dialog)) appRoot.inert = true
    modalStack.push(dialog)
    const controls = () => [...dialog.querySelectorAll(focusableSelector)].filter((node) => (
      !node.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(node).display !== 'none'
    ))
    ;(controls()[0] || dialog).focus()
    const onKeyDown = (event) => {
      if (modalStack.at(-1) !== dialog) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current?.()
      } else if (event.key === 'Tab') {
        const elements = controls()
        const index = elements.indexOf(document.activeElement)
        if (!elements.length) {
          event.preventDefault()
          dialog.focus()
        } else if (index < 0 || (event.shiftKey ? index === 0 : index === elements.length - 1)) {
          event.preventDefault()
          elements[event.shiftKey ? elements.length - 1 : 0].focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      modalStack.splice(modalStack.indexOf(dialog), 1)
      if (appRoot) appRoot.inert = wasInert || false
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return ref
}
