/**
 * Crea el PRIMER administrador (el dueño de la plataforma).
 * Lee ADMIN_NOMBRE, ADMIN_CORREO y ADMIN_PASSWORD del .env.
 * Si ya existe algún administrador no hace nada, salvo que uses --forzar.
 *
 *   npm run sembrar:admin
 */
require('dotenv').config();
const pool = require('../src/config/db');
const { AdministradorRepository } = require('../src/repositories/UsuarioRepository');
const { hashear, validarPasswordNueva } = require('../src/services/AuthService');

(async () => {
  try {
    const { ADMIN_NOMBRE, ADMIN_CORREO, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_NOMBRE || !ADMIN_CORREO || !ADMIN_PASSWORD) {
      throw new Error('Define ADMIN_NOMBRE, ADMIN_CORREO y ADMIN_PASSWORD en el .env');
    }
    if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(ADMIN_CORREO)) throw new Error('ADMIN_CORREO no es un correo válido');
    validarPasswordNueva(ADMIN_PASSWORD);

    if ((await AdministradorRepository.contar()) > 0 && !process.argv.includes('--forzar')) {
      console.log('Ya existe un administrador. No se creó nada (usa --forzar para añadir otro).');
      return;
    }
    const id = await AdministradorRepository.crear({
      nombre: ADMIN_NOMBRE.trim(),
      correo: ADMIN_CORREO.trim().toLowerCase(),
      passwordHash: await hashear(ADMIN_PASSWORD)
    });
    console.log(`✅ Administrador creado (id ${id}): ${ADMIN_CORREO}`);
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
