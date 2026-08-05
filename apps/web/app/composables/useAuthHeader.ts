export async function useAuthHeader() {
  const { data } = await useSupabaseClient().auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('not_authenticated')
  return { authorization: `Bearer ${accessToken}` }
}
