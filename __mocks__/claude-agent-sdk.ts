export const query = jest.fn(() => {
  throw new Error(
    'Claude Agent SDK runtime calls must be explicitly mocked in unit tests.',
  )
})
