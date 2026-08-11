-- Manual migration: platform-level super admin role
-- Date: 2026-08-11
--
-- Hasta ahora todo usuario y organización se creaba a mano con scripts. Para
-- vender la plataforma a varias empresas hace falta un rol por encima de las
-- organizaciones: alguien que pueda crear una empresa nueva y su primer
-- usuario sin pertenecer a ninguna empresa cliente. SUPER_ADMIN es ese rol —
-- sus cuentas viven en una organización interna de plataforma, nunca en la
-- de un cliente, y sus rutas no pasan por tenantMiddleware.

BEGIN;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

COMMIT;
