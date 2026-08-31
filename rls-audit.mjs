import { createClient } from '@supabase/supabase-js'

const URL = 'https://mfdzlhqhtkoxytwzaqfq.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZHpsaHFodGtveHl0d3phcWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NzY3MjEsImV4cCI6MjEwMzE1MjcyMX0.eLBGkF2doJXbXHXsB0tPS_oc6KL_l1BwbiF1G8e4rE8'

async function nuevoUsuario(tag) {
  const client = createClient(URL, ANON)
  const stamp = Date.now() + Math.floor(Math.random() * 1000)
  const email = `rls-${tag}-${stamp}@mabril.test`
  const username = `rls${tag}${stamp}`.slice(0, 20)
  const { data, error } = await client.auth.signUp({ email, password: 'MabrilQA12345!', options: { data: { username, display_name: `RLS ${tag}` } } })
  if (error) throw new Error(`signup ${tag}: ${error.message}`)
  return { client, userId: data.user.id, username }
}

function resumen(label, r) {
  const bloqueado = !!r.error
  console.log(`  ${label}: ${bloqueado ? 'BLOQUEADO ✅ (' + r.error.message.slice(0, 60) + ')' : r.data && r.data.length ? 'PERMITIDO ⚠️ (' + r.data.length + ' filas)' : 'sin filas (—)'}`)
  return { label, bloqueado, filas: r.data ? r.data.length : 0 }
}

const A = await nuevoUsuario('a')
const B = await nuevoUsuario('b')
console.log('Usuario A:', A.userId, A.username)
console.log('Usuario B:', B.userId, B.username)
await new Promise((r) => setTimeout(r, 800))

const anon = createClient(URL, ANON)

console.log('\n=== profiles ===')
resumen('anon lee todos los perfiles', await anon.from('profiles').select('id,username').limit(5))
resumen('A actualiza el perfil de B', await A.client.from('profiles').update({ bio: 'hackeado' }).eq('id', B.userId))

console.log('\n=== follows ===')
resumen('A inserta follow como si fuera B->A', await A.client.from('follows').insert({ follower_id: B.userId, following_id: A.userId }))
resumen('A sigue a B (normal, debe permitirse)', await A.client.from('follows').insert({ follower_id: A.userId, following_id: B.userId }))
resumen('B lee la fila de follows de A', await B.client.from('follows').select('*').eq('follower_id', A.userId))

console.log('\n=== blocks ===')
resumen('A inserta block como si fuera B', await A.client.from('blocks').insert({ blocker_id: B.userId, blocked_id: A.userId }))

console.log('\n=== posts ===')
const postB = await B.client.from('posts').insert({ author_id: B.userId, body: 'post privado de B', kind: 'text' }).select('id').maybeSingle()
console.log('  B crea post:', postB.error ? postB.error.message : postB.data?.id)
if (postB.data) {
  resumen('A actualiza (borra) el post de B', await A.client.from('posts').update({ body: 'hackeado' }).eq('id', postB.data.id))
  resumen('A elimina el post de B', await A.client.from('posts').delete().eq('id', postB.data.id))
  resumen('A lee el post de B (select)', await A.client.from('posts').select('*').eq('id', postB.data.id))
}

console.log('\n=== likes ===')
if (postB.data) {
  resumen('A inserta like como si fuera B', await A.client.from('likes').insert({ user_id: B.userId, post_id: postB.data.id }))
}

console.log('\n=== comments ===')
if (postB.data) {
  resumen('A inserta comentario como si fuera B', await A.client.from('comments').insert({ author_id: B.userId, post_id: postB.data.id, body: 'suplantado' }))
}

console.log('\n=== saved_posts ===')
if (postB.data) {
  resumen('A inserta saved_posts como si fuera B', await A.client.from('saved_posts').insert({ user_id: B.userId, post_id: postB.data.id }))
  resumen('A lee los guardados de B', await A.client.from('saved_posts').select('*').eq('user_id', B.userId))
}

console.log('\n=== stories ===')
const storyB = await B.client.from('stories').insert({ author_id: B.userId, media_type: 'photo', media_path: 'x', duration_sec: 6 }).select('id').maybeSingle()
console.log('  B crea story:', storyB.error ? storyB.error.message : storyB.data?.id)
if (storyB.data) {
  resumen('A borra la story de B', await A.client.from('stories').delete().eq('id', storyB.data.id))
}

console.log('\n=== story_views ===')
if (storyB.data) {
  resumen('A inserta story_view como si fuera B', await A.client.from('story_views').insert({ story_id: storyB.data.id, viewer_id: B.userId }))
}

console.log('\n=== notifications ===')
resumen('A lee las notificaciones de B', await A.client.from('notifications').select('*').eq('recipient_id', B.userId))
resumen('A inserta una notificación falsa para B', await A.client.from('notifications').insert({ recipient_id: B.userId, actor_id: A.userId, type: 'like' }))

console.log('\n=== reports ===')
resumen('A lee todos los reportes', await A.client.from('reports').select('*').limit(5))

console.log('\n=== follow_requests ===')
resumen('anon lee follow_requests', await anon.from('follow_requests').select('*').limit(1))
resumen('A inserta follow_request como si fuera B', await A.client.from('follow_requests').insert({ requester_id: B.userId, target_id: A.userId }))

console.log('\n=== radio_tracks ===')
resumen('anon lee radio_tracks', await anon.from('radio_tracks').select('*').limit(1))
resumen('A inserta radio_track como si fuera B', await A.client.from('radio_tracks').insert({ owner_id: B.userId, title: 'x', audio_path: 'x' }))

console.log('\n=== boosts ===')
resumen('anon lee boosts', await anon.from('boosts').select('*').limit(1))

console.log('\n=== post_views ===')
resumen('anon lee post_views', await anon.from('post_views').select('*').limit(1))

console.log('\n=== call_sessions ===')
resumen('anon lee call_sessions', await anon.from('call_sessions').select('*').limit(1))

console.log('\n=== houses ===')
resumen('anon lee houses', await anon.from('houses').select('*').limit(1))

console.log('\n=== wanted_ads ===')
resumen('anon lee wanted_ads', await anon.from('wanted_ads').select('*').limit(1))

console.log('\n=== aid_donations ===')
resumen('anon lee aid_donations', await anon.from('aid_donations').select('*').limit(1))

console.log('\n=== foundations ===')
resumen('anon lee foundations', await anon.from('foundations').select('*').limit(1))

console.log('\n=== communities ===')
resumen('anon lee communities', await anon.from('communities').select('*').limit(1))

console.log('\n=== studio_artist_verifications ===')
resumen('anon lee studio_artist_verifications', await anon.from('studio_artist_verifications').select('*').limit(1))

console.log('\n=== studio_artist_videos ===')
resumen('anon lee studio_artist_videos', await anon.from('studio_artist_videos').select('*').limit(1))

console.log('\nListo.')
