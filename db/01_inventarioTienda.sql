-- =====================================================
-- BASE DE DATOS: GESTION DE BAZAR & INVENTARIO DE BARRIO
-- SCRIPT LIMPIO UNIFICADO FINAL
-- =====================================================

DROP DATABASE IF EXISTS db_bazar_vecino;
CREATE DATABASE db_bazar_vecino CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE db_bazar_vecino;

-- Desactivar temporalmente restricciones de llaves foráneas para limpiar de forma segura
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS MovimientoFiado;
DROP TABLE IF EXISTS DetalleVenta;
DROP TABLE IF EXISTS Venta;
DROP TABLE IF EXISTS Cliente;
DROP TABLE IF EXISTS Producto;
DROP TABLE IF EXISTS Usuario;
DROP TABLE IF EXISTS Administrador;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================
-- 1. TABLA ADMINISTRADOR (Tú, el dueño de la plataforma)
-- =====================================================
CREATE TABLE Administrador (
    id_admin INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- =====================================================
-- 2. TABLA USUARIO (La señora tendera / dueña del bazar)
-- =====================================================
CREATE TABLE Usuario (
    id_usuario INT PRIMARY KEY AUTO_INCREMENT,
    id_admin INT NOT NULL,
    nombre_tienda VARCHAR(150) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    usuario_login VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    estado ENUM('ACTIVO', 'SUSPENDIDO', 'INACTIVO') DEFAULT 'ACTIVO',
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_usuario_admin
    FOREIGN KEY (id_admin)
    REFERENCES Administrador(id_admin)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================
-- 3. TABLA PRODUCTO (Inventario del bazar)
-- =====================================================
CREATE TABLE Producto (
    id_producto INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    codigo_barras VARCHAR(50) UNIQUE NULL,
    precio_costo DECIMAL(10,2) NOT NULL,
    precio_venta DECIMAL(10,2) NOT NULL,
    stock_actual INT NOT NULL DEFAULT 0,
    stock_minimo INT NOT NULL DEFAULT 5,
    unidad_medida VARCHAR(30) DEFAULT 'unidad',
    estado ENUM('Disponible', 'Agotado', 'Inactivo') DEFAULT 'Disponible',

    CONSTRAINT fk_producto_usuario
    FOREIGN KEY (id_usuario)
    REFERENCES Usuario(id_usuario)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================
-- 4. TABLA CLIENTE (El vecino del barrio / deudor)
-- =====================================================
CREATE TABLE Cliente (
    id_cliente INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(200),
    limite_credito DECIMAL(10,2) DEFAULT 0.00,
    saldo_deudor DECIMAL(10,2) DEFAULT 0.00,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_cliente_usuario
    FOREIGN KEY (id_usuario)
    REFERENCES Usuario(id_usuario)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================
-- 5. TABLA VENTA (Cabecera del ticket en mostrador)
-- =====================================================
CREATE TABLE Venta (
    id_venta INT PRIMARY KEY AUTO_INCREMENT,
    id_usuario INT NOT NULL,
    id_cliente INT NULL, -- NULL si es venta al paso / contado
    fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
    monto_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    metodo_pago ENUM('Efectivo', 'Yape/Plin', 'Fiado', 'Tarjeta') NOT NULL,
    estado_venta ENUM('Completada', 'Pendiente', 'Anulada') DEFAULT 'Completada',
    observaciones TEXT,

    CONSTRAINT fk_venta_usuario
    FOREIGN KEY (id_usuario)
    REFERENCES Usuario(id_usuario),

    CONSTRAINT fk_venta_cliente
    FOREIGN KEY (id_cliente)
    REFERENCES Cliente(id_cliente)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- =====================================================
-- 6. TABLA DETALLE_VENTA (Ítems comprados)
-- =====================================================
CREATE TABLE DetalleVenta (
    id_venta INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario_historico DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) GENERATED ALWAYS AS (cantidad * precio_unitario_historico) STORED,

    PRIMARY KEY (id_venta, id_producto),

    CONSTRAINT fk_detalle_venta
    FOREIGN KEY (id_venta)
    REFERENCES Venta(id_venta)
    ON DELETE CASCADE,

    CONSTRAINT fk_detalle_producto
    FOREIGN KEY (id_producto)
    REFERENCES Producto(id_producto)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

-- =====================================================
-- 7. TABLA MOVIMIENTO_FIADO (El cuaderno digital)
-- =====================================================
CREATE TABLE MovimientoFiado (
    id_movimiento INT PRIMARY KEY AUTO_INCREMENT,
    id_cliente INT NOT NULL,
    id_venta INT NULL,
    tipo_movimiento ENUM('DEUDA', 'PAGO') NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    saldo_anterior DECIMAL(10,2) NOT NULL,
    saldo_nuevo DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME DEFAULT CURRENT_TIMESTAMP,
    observacion VARCHAR(255),

    CONSTRAINT fk_movimiento_cliente
    FOREIGN KEY (id_cliente)
    REFERENCES Cliente(id_cliente)
    ON DELETE CASCADE,

    CONSTRAINT fk_movimiento_venta
    FOREIGN KEY (id_venta)
    REFERENCES Venta(id_venta)
    ON DELETE SET NULL
) ENGINE=InnoDB;

-- ==========================================
-- ÍNDICES DE RENDIMIENTO CLAVE
-- ==========================================
CREATE INDEX idx_producto_usuario ON Producto(id_usuario);
CREATE INDEX idx_venta_fecha ON Venta(fecha_hora);
CREATE INDEX idx_cliente_usuario ON Cliente(id_usuario);
CREATE INDEX idx_movimiento_cliente ON MovimientoFiado(id_cliente);

-- ==========================================
-- VISTAS ÚTILES
-- ==========================================
DROP VIEW IF EXISTS vw_VentasDelDia;
CREATE VIEW vw_VentasDelDia AS
SELECT 
    v.id_venta,
    u.nombre_tienda,
    COALESCE(c.nombre, 'Público General / Al Paso') AS cliente,
    v.fecha_hora,
    v.monto_total,
    v.metodo_pago,
    v.estado_venta
FROM Venta v
INNER JOIN Usuario u ON v.id_usuario = u.id_usuario
LEFT JOIN Cliente c ON v.id_cliente = c.id_cliente
WHERE DATE(v.fecha_hora) = CURDATE();

DROP VIEW IF EXISTS vw_StockCritico;
CREATE VIEW vw_StockCritico AS
SELECT 
    p.id_producto,
    u.nombre_tienda,
    p.nombre AS producto,
    p.stock_actual,
    p.stock_minimo,
    p.precio_venta
FROM Producto p
INNER JOIN Usuario u ON p.id_usuario = u.id_usuario
WHERE p.stock_actual <= p.stock_minimo AND p.estado = 'Disponible';

-- ==========================================
-- PROCEDIMIENTOS ALMACENADOS (STORED PROCEDURES)
-- ==========================================
DELIMITER //

-- 1. Login para la tendera
DROP PROCEDURE IF EXISTS sp_LoginTendera //
CREATE PROCEDURE sp_LoginTendera(
    IN p_usuario VARCHAR(50),
    IN p_contra VARCHAR(255)
)
BEGIN
    SELECT id_usuario, id_admin, nombre_tienda, telefono, usuario_login, estado
    FROM Usuario
    WHERE usuario_login = p_usuario AND password_hash = p_contra AND estado = 'ACTIVO';
END //

-- 2. Registrar una Venta y descontar Stock automáticamente
DROP PROCEDURE IF EXISTS sp_RegistrarVentaBazar //
CREATE PROCEDURE sp_RegistrarVentaBazar(
    IN p_id_usuario INT,
    IN p_id_cliente INT,
    IN p_metodo_pago VARCHAR(20),
    OUT p_id_venta_gen INT
)
BEGIN
    INSERT INTO Venta(id_usuario, id_cliente, monto_total, metodo_pago, estado_venta)
    VALUES(p_id_usuario, p_id_cliente, 0.00, p_metodo_pago, 'Completada');

    SET p_id_venta_gen = LAST_INSERT_ID();
END //

-- 3. Agregar Ítem a la Venta (Actualiza stock y total)
DROP PROCEDURE IF EXISTS sp_AgregarItemVenta //
CREATE PROCEDURE sp_AgregarItemVenta(
    IN p_id_venta INT,
    IN p_id_producto INT,
    IN p_cantidad INT
)
BEGIN
    DECLARE v_precio DECIMAL(10,2);
    DECLARE v_stock INT;

    -- Obtener precio actual y stock del producto
    SELECT precio_venta, stock_actual INTO v_precio, v_stock
    FROM Producto WHERE id_producto = p_id_producto;

    IF v_stock < p_cantidad THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Stock insuficiente en el bazar para este producto';
    ELSE
        -- Insertar detalle con precio histórico
        INSERT INTO DetalleVenta(id_venta, id_producto, cantidad, precio_unitario_historico)
        VALUES(p_id_venta, p_id_producto, p_cantidad, v_precio);

        -- Descontar stock
        UPDATE Producto
        SET stock_actual = stock_actual - p_cantidad
        WHERE id_producto = p_id_producto;

        -- Actualizar monto total de la venta
        UPDATE Venta
        SET monto_total = (SELECT SUM(subtotal) FROM DetalleVenta WHERE id_venta = p_id_venta)
        WHERE id_venta = p_id_venta;
    END IF;
END //

-- 4. Registrar Fiado / Abono del vecino (Cuaderno digital)
DROP PROCEDURE IF EXISTS sp_RegistrarMovimientoFiado //
CREATE PROCEDURE sp_RegistrarMovimientoFiado(
    IN p_id_cliente INT,
    IN p_id_venta INT,
    IN p_tipo ENUM('DEUDA', 'PAGO'),
    IN p_monto DECIMAL(10,2),
    IN p_observacion VARCHAR(255)
)
BEGIN
    DECLARE v_saldo_actual DECIMAL(10,2);
    DECLARE v_nuevo_saldo DECIMAL(10,2);

    -- Obtener el saldo deudor actual del cliente
    SELECT saldo_deudor INTO v_saldo_actual
    FROM Cliente WHERE id_cliente = p_id_cliente;

    -- Calcular nuevo saldo según sea deuda o pago
    IF p_tipo = 'DEUDA' THEN
        SET v_nuevo_saldo = v_saldo_actual + p_monto;
    ELSE
        SET v_nuevo_saldo = v_saldo_actual - p_monto;
    END IF;

    -- Insertar el movimiento en el historial
    INSERT INTO MovimientoFiado(id_cliente, id_venta, tipo_movimiento, monto, saldo_anterior, saldo_nuevo, observacion)
    VALUES(p_id_cliente, p_id_venta, p_tipo, p_monto, v_saldo_actual, v_nuevo_saldo, p_observacion);

    -- Actualizar el saldo deudor global del cliente
    UPDATE Cliente
    SET saldo_deudor = v_nuevo_saldo
    WHERE id_cliente = p_id_cliente;
END //

DELIMITER ;