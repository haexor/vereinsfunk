import { defineEventHandler, getRouterParam, sendRedirect } from 'h3'

export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')
  if (!token) return sendRedirect(event, '/', 301)

  return sendRedirect(event, `/einladung?token=${encodeURIComponent(token)}`, 301)
})
