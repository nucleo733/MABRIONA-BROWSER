'use strict'

/**
 * MABRIONA SHIELDS — bloqueador de anuncios/rastreadores de terceros,
 * el mismo tipo de función que trae cualquier navegador real (Brave,
 * Firefox con Enhanced Tracking Protection, Safari con Intelligent
 * Tracking Prevention, uBlock Origin). Bloquea pedidos de red a
 * dominios de publicidad/rastreo conocidos, en CUALQUIER sitio que el
 * navegador cargue — es una decisión legítima del propio navegador
 * sobre lo que renderiza, no una evasión del mecanismo de anuncios de
 * un sitio de terceros.
 *
 * A propósito NO incluye youtube.com/googlevideo.com/ytimg.com: los
 * anuncios dentro del reproductor de YouTube viajan por el mismo canal
 * que el video real (CDN de video, no un dominio de "ads" separado) —
 * bloquearlos rompería la reproducción del video en sí, y esa no es la
 * función de este bloqueador (ver /Users/wber733/repos/MABRIONA-STUDIO,
 * fase "reproducción de YouTube sin interrupciones publicitarias" —
 * ahí se documentó por qué eso no se implementa).
 */
const AD_TRACKER_DOMAINS = [
  // Google Ads / DoubleClick
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adservice.google.com', 'pagead2.googlesyndication.com',
  // Meta / Facebook
  'facebook.net', 'connect.facebook.net', 'ads.facebook.com',
  // Amazon
  'amazon-adsystem.com',
  // Programmatic / ad exchanges
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'openx.net',
  'bidswitch.net', 'casalemedia.com', 'adform.net', 'mathtag.com',
  'criteo.com', 'criteo.net', 'smartadserver.com', 'adroll.com',
  'media.net', 'yieldmo.com', 'sharethrough.com', 'contextweb.com',
  'adsrvr.org', 'agkn.com', 'bluekai.com', 'exelator.com',
  // Content recommendation / native ads
  'outbrain.com', 'taboola.com', 'revcontent.com', 'mgid.com',
  // Twitter/X ads
  'ads-twitter.com', 'static.ads-twitter.com',
  // Mobile ad networks
  'adcolony.com', 'applovin.com', 'unityads.unity3d.com',
  'chartboost.com', 'vungle.com', 'mopub.com', 'flurry.com',
  // Attribution / cross-app tracking
  'appsflyer.com', 'branch.io', 'adjust.com', 'kochava.com',
  // Web analytics / session replay trackers (no infraestructura legítima como CDNs)
  'scorecardresearch.com', 'quantserve.com', 'moatads.com',
  'addthis.com', 'chartbeat.com', 'hotjar.com', 'crazyegg.com',
  'fullstory.com', 'mouseflow.com',
  // Popup/redirect ad networks
  'propellerads.com', 'popads.net', 'popcash.net',
]

/** true si el hostname del pedido pertenece a un dominio de la lista (o a un subdominio suyo). */
function isBlockedHost(hostname) {
  if (!hostname) return false
  const h = hostname.toLowerCase()
  return AD_TRACKER_DOMAINS.some((domain) => h === domain || h.endsWith(`.${domain}`))
}

module.exports = { AD_TRACKER_DOMAINS, isBlockedHost }
