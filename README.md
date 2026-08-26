# Cubre Canas — Shopify Order App

Proyecto base para recibir un pedido mediante formulario y crearlo directamente en Shopify usando la Admin GraphQL API.

## Importante

Los precios exactos y los IDs de variantes de Shopify no están incluidos en este archivo porque deben corresponder a tu producto real. Se configuran mediante variables de entorno.

## Flujo

Cliente → formulario → servidor → Shopify Admin API → pedido PENDING (pago contra entrega).

## Alcance

La app necesita `write_orders`.

## Configuración

1. Copia `.env.example` como `.env`.
2. Completa `SHOPIFY_SHOP`.
3. Completa `SHOPIFY_ACCESS_TOKEN`.
4. Completa los 3 `PACKAGE_*_VARIANT_ID`.
5. Coloca los precios reales en `PACKAGE_*_PRICE`.
6. Ejecuta `npm install`.
7. Ejecuta `npm start`.

## Seguridad

El token de Shopify solo debe existir en variables de entorno del servidor. Nunca lo pongas dentro de `public/index.html` ni en el repositorio.

## API

La creación del pedido usa `orderCreate` de Shopify Admin GraphQL API con `financialStatus: PENDING`.
