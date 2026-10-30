process.env.NODE_ENV = 'test';
const V = require('../src/utils/validaciones');
const { aCentimos, aSoles, redondear } = require('../src/utils/dinero');
const { sumarDias } = require('../src/utils/fechas');
const { validarVenta } = require('../src/services/VentaService');

describe('dinero', () => {
  test('suma en céntimos evita errores de coma flotante', () => {
    expect(aCentimos(0.1) + aCentimos(0.2)).toBe(30);
    expect(aSoles(aCentimos(19.99) * 3)).toBe(59.97);
    expect(redondear(1.005)).toBe(1.01);
  });
});

describe('validaciones', () => {
  test('monto acepta 2 decimales y rechaza 3', () => {
    expect(V.monto('3.50', 'x')).toBe(3.5);
    expect(() => V.monto('3.555', 'x')).toThrow(/2 decimales/);
    expect(() => V.monto(-1, 'x')).toThrow();
    expect(() => V.monto('abc', 'x')).toThrow();
  });
  test('entero', () => {
    expect(V.entero('5', 'x')).toBe(5);
    expect(V.entero(undefined, 'x')).toBeNull();
    expect(() => V.entero(1.5, 'x')).toThrow(/entero/);
    expect(() => V.entero(0, 'x', { min: 1 })).toThrow();
  });
  test('fecha rechaza días inexistentes', () => {
    expect(V.fecha('2026-10-28')).toBe('2026-10-28');
    expect(() => V.fecha('2026-02-31')).toThrow(/válida/);
    expect(() => V.fecha('28/10/2026')).toThrow(/AAAA-MM-DD/);
  });
  test('escaparLike neutraliza comodines', () => {
    expect(V.escaparLike('50%_off')).toBe('50\\%\\_off');
  });
  test('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(sumarDias('2026-03-01', -30)).toBe('2026-01-30');
  });
});

describe('validarVenta', () => {
  const base = { items: [{ id_producto: 1, cantidad: 2 }] };

  test('método por defecto Efectivo', () => {
    expect(validarVenta(base).metodoPago).toBe('Efectivo');
  });
  test('junta el mismo producto repetido', () => {
    const r = validarVenta({ items: [{ id_producto: 1, cantidad: 2 }, { id_producto: 1, cantidad: 3 }] });
    expect(r.items).toEqual([{ idProducto: 1, cantidad: 5 }]);
  });
  test('carrito vacío', () => {
    expect(() => validarVenta({ items: [] })).toThrow(/vacío/);
    expect(() => validarVenta({})).toThrow(/vacío/);
  });
  test('fiado exige vecino', () => {
    expect(() => validarVenta({ ...base, metodo_pago: 'Fiado' })).toThrow(/vecino/);
    expect(validarVenta({ ...base, metodo_pago: 'Fiado', id_cliente: 4 }).idCliente).toBe(4);
  });
  test('cantidad inválida y método inválido', () => {
    expect(() => validarVenta({ items: [{ id_producto: 1, cantidad: 0 }] })).toThrow();
    expect(() => validarVenta({ items: [{ id_producto: 1, cantidad: 1.5 }] })).toThrow();
    expect(() => validarVenta({ ...base, metodo_pago: 'Bitcoin' })).toThrow(/Opciones/);
  });
  test('uuid mal formado', () => {
    expect(() => validarVenta({ ...base, uuid_cliente: 'abc' })).toThrow(/UUID/);
  });
});
