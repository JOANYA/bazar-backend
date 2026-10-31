-- =====================================================
-- EXTENSIONES DEL ESQUEMA (ejecutar UNA SOLA VEZ, después de 01_inventarioTienda.sql)
-- Requiere MySQL 8.0.16 o superior (por los CHECK).
--
-- No toca tus tablas existentes más allá de AGREGAR columnas/índices.
-- Todo lo nuevo sirve a una función concreta del bazar:
--   * Productos favoritos y foto           -> pantalla "Un Toque"
--   * Presentaciones (caja de 24 = 24 u.)  -> entrada de mercadería
--   * Compra / DetalleCompra               -> "Carga Rápida de Factura de Proveedor"
--   * MovimientoStock                      -> historial: de dónde salió/entró cada unidad
--   * CierreCaja                           -> "Cerrar Día y Guardar Reporte"
--   * Venta.uuid_cliente                   -> que un reintento de la PWA sin internet no duplique la venta
-- =====================================================

USE db_bazar_vecino;

-- -----------------------------------------------------
-- PRODUCTO
-- -----------------------------------------------------
ALTER TABLE Producto
    ADD COLUMN es_favorito TINYINT(1) NOT NULL DEFAULT 0 AFTER estado,
    ADD COLUMN imagen_url  VARCHAR(255) NULL AFTER es_favorito;

-- CORRECCIÓN IMPORTANTE: codigo_barras era UNIQUE a nivel de TODA la base.
-- Con varias tiendas, si dos bazares venden la misma gaseosa (mismo código de
-- barras), la segunda no podría registrarla. Ahora es único POR TIENDA.
ALTER TABLE Producto DROP INDEX codigo_barras;
ALTER TABLE Producto ADD CONSTRAINT uq_producto_barras UNIQUE (id_usuario, codigo_barras);

-- Red de seguridad: aunque dos ventas simultáneas pasen la validación de la app,
-- la base jamás permitirá stock negativo ni precios negativos.
ALTER TABLE Producto ADD CONSTRAINT chk_producto_stock  CHECK (stock_actual >= 0);
ALTER TABLE Producto ADD CONSTRAINT chk_producto_precios CHECK (precio_costo >= 0 AND precio_venta >= 0);

-- -----------------------------------------------------
-- PRESENTACIONES (Caja x24, Six-pack, Docena...)
-- El stock SIEMPRE se guarda en unidades mínimas; la presentación solo ayuda
-- a convertir al ingresar mercadería.
-- -----------------------------------------------------
CREATE TABLE PresentacionProducto (
    id_presentacion INT PRIMARY KEY AUTO_INCREMENT,
    id_producto INT NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    unidades INT NOT NULL,

    CONSTRAINT chk_presentacion_unidades CHECK (unidades >= 2),
    CONSTRAINT uq_presentacion UNIQUE (id_producto, nombre),
    CONSTRAINT fk_presentacion_producto
    FOREIGN KEY (id_producto) REFERENCES Producto(id_producto)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- VENTA / DETALLE / FIADO
-- -----------------------------------------------------
-- Para calcular ganancia real: el costo del producto puede cambiar con el tiempo,
-- igual que ya guardas el precio de venta histórico.
ALTER TABLE DetalleVenta
    ADD COLUMN costo_unitario_historico DECIMAL(10,2) NULL AFTER precio_unitario_historico;

-- Identificador generado por el celular/tablet al armar la venta. Si el internet
-- se cae y la PWA reenvía la misma venta, la base la reconoce y no la duplica.
ALTER TABLE Venta ADD COLUMN uuid_cliente CHAR(36) NULL;
ALTER TABLE Venta ADD CONSTRAINT uq_venta_uuid UNIQUE (id_usuario, uuid_cliente);
CREATE INDEX idx_venta_usuario_fecha ON Venta(id_usuario, fecha_hora);

-- Con qué pagó el vecino su abono (efectivo entra a la gaveta; Yape no).
-- NULL = movimiento que no es un cobro real (p. ej. reverso por venta anulada).
ALTER TABLE MovimientoFiado
    ADD COLUMN metodo_pago ENUM('Efectivo', 'Yape/Plin', 'Tarjeta') NULL AFTER monto;
CREATE INDEX idx_movimiento_fecha ON MovimientoFiado(fecha_hora);

-- -----------------------------------------------------
-- HISTORIAL DE STOCK (kardex simple)
-- cantidad lleva signo: +entra / -sale
-- -----------------------------------------------------
CREATE TABLE MovimientoStock (
    id_movimiento INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    id_producto INT NOT NULL,
    tipo ENUM('INICIAL', 'VENTA', 'ANULACION', 'COMPRA', 'AJUSTE') NOT NULL,
    cantidad INT NOT NULL,
    stock_resultante INT NOT NULL,
    id_referencia INT NULL,
    motivo VARCHAR(255) NULL,
    fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_movstock_producto (id_producto, fecha_hora),
    CONSTRAINT fk_movstock_usuario
    FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
    ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_movstock_producto
    FOREIGN KEY (id_producto) REFERENCES Producto(id_producto)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- COMPRAS A PROVEEDOR (entrada de mercadería)
-- -----------------------------------------------------
CREATE TABLE Compra (
    id_compra INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    proveedor VARCHAR(150) NULL,
    fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_costo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    observaciones VARCHAR(255) NULL,

    INDEX idx_compra_usuario_fecha (id_usuario, fecha_hora),
    CONSTRAINT fk_compra_usuario
    FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE DetalleCompra (
    id_detalle INT PRIMARY KEY AUTO_INCREMENT,
    id_compra INT NOT NULL,
    id_producto INT NOT NULL,
    id_presentacion INT NULL,
    cantidad_comprada INT NOT NULL,      -- 3 cajas
    unidades_ingresadas INT NOT NULL,    -- 72 unidades que entran al stock
    costo_unitario DECIMAL(10,2) NOT NULL,
    costo_total DECIMAL(10,2) NOT NULL,

    CONSTRAINT fk_detcompra_compra
    FOREIGN KEY (id_compra) REFERENCES Compra(id_compra)
    ON DELETE CASCADE,
    CONSTRAINT fk_detcompra_producto
    FOREIGN KEY (id_producto) REFERENCES Producto(id_producto)
    ON DELETE RESTRICT,
    CONSTRAINT fk_detcompra_presentacion
    FOREIGN KEY (id_presentacion) REFERENCES PresentacionProducto(id_presentacion)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- CIERRE DE CAJA (una foto del día por tienda)
-- Volver a cerrar el mismo día recalcula y reemplaza la foto.
-- -----------------------------------------------------
CREATE TABLE CierreCaja (
    id_cierre INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    fecha DATE NOT NULL,
    num_ventas INT NOT NULL DEFAULT 0,
    total_vendido DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ventas_efectivo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ventas_yape_plin DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ventas_tarjeta DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ventas_fiado DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    cobros_efectivo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    cobros_digital DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    efectivo_en_gaveta DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    ganancia_estimada DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    producto_estrella VARCHAR(150) NULL,
    fecha_hora_cierre DATETIME DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_cierre_dia UNIQUE (id_usuario, fecha),
    CONSTRAINT fk_cierre_usuario
    FOREIGN KEY (id_usuario) REFERENCES Usuario(id_usuario)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- Actualizar el ENUM de métodos de pago en la tabla Venta para separar Yape y Plin
ALTER TABLE Venta 
MODIFY COLUMN metodo_pago ENUM('Efectivo', 'Yape', 'Plin', 'Fiado', 'Tarjeta') NOT NULL;


--actualizar las columnas de mysql de yape_plin a yape plin por separado
ALTER TABLE CierreCaja 
ADD COLUMN ventas_yape DECIMAL(10,2) DEFAULT 0 AFTER ventas_efectivo,
ADD COLUMN ventas_plin DECIMAL(10,2) DEFAULT 0 AFTER ventas_yape;