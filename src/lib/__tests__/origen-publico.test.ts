import { describe, it, expect } from 'vitest'
import { destinoSeguro } from '../origen-publico'

const AQUI = 'https://delivery.procovar.cloud'

describe('destinoSeguro', () => {
  it('deja volver a una ruta de aquí', () => {
    expect(destinoSeguro('/rutas', AQUI)).toBe(`${AQUI}/rutas`)
    expect(destinoSeguro('/dashboard?dia=hoy', AQUI)).toBe(`${AQUI}/dashboard?dia=hoy`)
  })

  it('deja volver a una dirección completa de aquí', () => {
    expect(destinoSeguro(`${AQUI}/pedidos`, AQUI)).toBe(`${AQUI}/pedidos`)
  })

  it('NO deja mandar a otro sitio', () => {
    // Sin esto, un enlace `…/api/auth/entrar?volverA=https://sitio-falso/`
    // llevaría a la persona, ya identificada de verdad, a una copia del sistema
    // pidiéndole la contraseña — y habiendo pasado por nuestro dominio, que es
    // justo lo que da confianza.
    expect(destinoSeguro('https://sitio-falso.com/entrar', AQUI)).toBe(`${AQUI}/dashboard`)
  })

  it('NO se deja engañar por la doble barra', () => {
    // `//otro-sitio.com` empieza por barra, así que una comprobación ingenua de
    // "es una ruta" lo daría por bueno; el navegador lo lee como otro dominio.
    expect(destinoSeguro('//sitio-falso.com', AQUI)).toBe(`${AQUI}/dashboard`)
    expect(destinoSeguro('//sitio-falso.com/algo', AQUI)).toBe(`${AQUI}/dashboard`)
  })

  it('NO se deja engañar por un dominio que empieza igual', () => {
    // `delivery.procovar.cloud.sitio-falso.com` contiene nuestro dominio entero.
    expect(destinoSeguro('https://delivery.procovar.cloud.sitio-falso.com/x', AQUI))
      .toBe(`${AQUI}/dashboard`)
  })

  it('NO deja otros esquemas', () => {
    expect(destinoSeguro('javascript:alert(1)', AQUI)).toBe(`${AQUI}/dashboard`)
  })

  it('sin destino, al panel', () => {
    expect(destinoSeguro(null, AQUI)).toBe(`${AQUI}/dashboard`)
    expect(destinoSeguro('', AQUI)).toBe(`${AQUI}/dashboard`)
  })
})
