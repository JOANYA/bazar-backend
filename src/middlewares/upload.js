const multer = require('multer');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Límite de 5MB
});

exports.uploadImage = upload.single('imagen');