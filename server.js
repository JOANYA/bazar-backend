require('dotenv').config();
const app = require('./app');
const { probarConexion } = require('./src/config/db');

const puerto = process.env.PORT || 3000;

app.listen(puerto, async () => {
  console.log(`✅ API del bazar escuchando en http://localhost:${puerto}`);
  try {
    const { db, ahora } = await probarConexion();
    console.log(`✅ MySQL conectado: ${db} (hora del negocio: ${ahora})`);
  } catch (e) {
    console.error('❌ No se pudo conectar a MySQL:', e.message);
  }
});
