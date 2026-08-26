require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const API_VERSION =
  process.env.SHOPIFY_API_VERSION || "2026-07";

const DEFAULT_CURRENCY =
  process.env.SHOPIFY_CURRENCY || "PYG";

let shopifyToken = null;
let shopifyTokenExpiresAt = 0;

/* =========================================
   PRECIOS Y PAQUETES
========================================= */

const DEFAULT_PACKAGES = [
  {
    id: "1",
    label: "1 unidad",
    price: 169000
  },
  {
    id: "2",
    label: "2 unidades",
    price: 321100
  },
  {
    id: "3",
    label: "3 unidades",
    price: 456300
  }
];

function packagesFromEnv() {
  return DEFAULT_PACKAGES.map((defaultPack) => {
    const n = defaultPack.id;

    const envPrice =
      process.env[`PACKAGE_${n}_PRICE`];

    const envLabel =
      process.env[`PACKAGE_${n}_LABEL`];

    const variantId =
      process.env[`PACKAGE_${n}_VARIANT_ID`] || "";

    const parsedPrice =
      Number(envPrice);

    return {
      id: defaultPack.id,

      label:
        envLabel ||
        defaultPack.label,

      price:
        envPrice &&
        !Number.isNaN(parsedPrice)
          ? parsedPrice
          : defaultPack.price,

      variantId
    };
  });
}

/* =========================================
   SHOPIFY ACCESS TOKEN
========================================= */

async function getShopifyAccessToken() {
  if (
    shopifyToken &&
    Date.now() < shopifyTokenExpiresAt
  ) {
    return shopifyToken;
  }

  if (
    !SHOP ||
    !CLIENT_ID ||
    !CLIENT_SECRET
  ) {
    throw new Error(
      "Faltan las credenciales de Shopify en las variables de entorno."
    );
  }

  const response = await fetch(
    `https://${SHOP}/admin/oauth/access_token`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body: new URLSearchParams({
        grant_type:
          "client_credentials",

        client_id:
          CLIENT_ID,

        client_secret:
          CLIENT_SECRET
      })
    }
  );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `Shopify authentication error: ${JSON.stringify(data)}`
    );
  }

  shopifyToken =
    data.access_token;

  shopifyTokenExpiresAt =
    Date.now() +
    ((data.expires_in || 86399) - 300) *
      1000;

  return shopifyToken;
}

/* =========================================
   CONFIG DEL FORMULARIO
========================================= */

app.get(
  "/api/config",
  (_req, res) => {
    const packages =
      packagesFromEnv().map(
        ({
          id,
          label,
          price
        }) => ({
          id,
          label,
          price
        })
      );

    res.json({
      productName:
        process.env.PRODUCT_NAME ||
        "Cubre Canas",

      currency:
        DEFAULT_CURRENCY,

      delivery:
        "Delivery gratis",

      payment:
        "Pago contra entrega",

      packages
    });
  }
);

/* =========================================
   LIMPIEZA DE DATOS
========================================= */

function clean(
  value,
  max = 200
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(0, max);
}

/* =========================================
   COLORES PERMITIDOS
========================================= */

const VALID_COLORS = [
  "Negro",
  "Rojizo",
  "Café"
];

/* =========================================
   VALIDAR PEDIDO
========================================= */

function validateOrder(body) {
  const required = [
    "firstName",
    "lastName",
    "phone",
    "address",
    "city",
    "packageId"
  ];

  for (
    const field of required
  ) {
    if (
      !clean(body[field])
    ) {
      return `Falta completar: ${field}`;
    }
  }

  /* =====================================
     COMPATIBILIDAD COLOR

     El formulario actual manda:
     color

     Si alguna versión anterior manda:
     colors

     también lo aceptamos.
  ===================================== */

  const color =
    clean(body.color, 60) ||
    clean(body.colors, 60);

  if (!color) {
    return "Selecciona un color.";
  }

  if (
    !VALID_COLORS.includes(color)
  ) {
    return (
      "Color no válido. " +
      "Selecciona Negro, Rojizo o Café."
    );
  }

  /* =====================================
     CANTIDAD / PACK
  ===================================== */

  if (
    !["1", "2", "3"].includes(
      String(body.packageId)
    )
  ) {
    return "Cantidad no válida.";
  }

  return null;
}

/* =========================================
   SHOPIFY GRAPHQL
========================================= */

const ORDER_CREATE = `
mutation orderCreate($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    userErrors {
      field
      message
    }

    order {
      id
      name
      displayFinancialStatus
    }
  }
}
`;

/* =========================================
   CREAR PEDIDO
========================================= */

app.post(
  "/api/orders",
  async (req, res) => {
    try {
      /* ===================================
         CREDENCIALES
      =================================== */

      if (
        !SHOP ||
        !CLIENT_ID ||
        !CLIENT_SECRET
      ) {
        return res.status(500).json({
          ok: false,

          message:
            "La aplicación todavía no está configurada con las credenciales de Shopify."
        });
      }

      /* ===================================
         VALIDACIÓN
      =================================== */

      const error =
        validateOrder(
          req.body
        );

      if (error) {
        return res.status(400).json({
          ok: false,
          message: error
        });
      }

      const body =
        req.body;

      /* ===================================
         PAQUETES
      =================================== */

      const packages =
        packagesFromEnv();

      const selected =
        packages.find(
          (p) =>
            p.id ===
            String(
              body.packageId
            )
        );

      if (!selected) {
        return res.status(400).json({
          ok: false,

          message:
            "El paquete seleccionado no es válido."
        });
      }

      if (
        !selected.variantId
      ) {
        return res.status(500).json({
          ok: false,

          message:
            `Falta configurar la variante de Shopify para ${selected.label}.`
        });
      }

      /* ===================================
         DATOS
      =================================== */

      const firstName =
        clean(
          body.firstName,
          80
        );

      const lastName =
        clean(
          body.lastName,
          80
        );

      const email =
        clean(
          body.email,
          160
        );

      const phone =
        clean(
          body.phone,
          40
        );

      const address =
        clean(
          body.address,
          180
        );

      const city =
        clean(
          body.city,
          80
        );

      const notes =
        clean(
          body.notes,
          500
        );

      const color =
        clean(
          body.color,
          60
        ) ||
        clean(
          body.colors,
          60
        );

      /* ===================================
         PEDIDO

         IMPORTANTE:
         Cada PACKAGE tiene su propia
         variante de Shopify.

         Por eso quantity = 1.

         Ejemplo:
         PACKAGE_2_VARIANT_ID =
         variante "2 unidades"

         No debemos mandar quantity = 2,
         porque eso duplicaría el pack.
      =================================== */

      const order = {
        lineItems: [
          {
            variantId:
              selected.variantId,

            quantity: 1
          }
        ],

        customer: {
          toUpsert: {
            firstName,
            lastName,

            ...(email
              ? {
                  email
                }
              : {}),

            ...(phone
              ? {
                  phone
                }
              : {})
          }
        },

        email:
          email || undefined,

        phone,

        financialStatus:
          "PENDING",

        shippingAddress: {
          firstName,
          lastName,
          address1:
            address,
          city,
          countryCode:
            "PY",
          phone
        },

        billingAddress: {
          firstName,
          lastName,
          address1:
            address,
          city,
          countryCode:
            "PY",
          phone
        },

        note: [
          "Pedido desde formulario Cubre Canas",

          `Color: ${color}`,

          `Cantidad/pack: ${selected.label}`,

          `Precio: ${selected.price} Gs`,

          "Delivery: gratis",

          "Pago: contra entrega",

          notes
            ? `Nota: ${notes}`
            : ""
        ]
          .filter(Boolean)
          .join(" | ")
      };

      /* ===================================
         ELIMINAR UNDEFINED
      =================================== */

      Object.keys(order)
        .forEach(
          (key) => {
            if (
              order[key] ===
              undefined
            ) {
              delete order[key];
            }
          }
        );

      /* ===================================
         TOKEN SHOPIFY
      =================================== */

      const token =
        await getShopifyAccessToken();

      /* ===================================
         ENVIAR A SHOPIFY
      =================================== */

      const response =
        await fetch(
          `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              "X-Shopify-Access-Token":
                token
            },

            body:
              JSON.stringify({
                query:
                  ORDER_CREATE,

                variables: {
                  order
                }
              })
          }
        );

      const data =
        await response.json();

      /* ===================================
         ERROR HTTP
      =================================== */

      if (!response.ok) {
        console.error(
          "Shopify HTTP error:",
          data
        );

        return res.status(502).json({
          ok: false,

          message:
            "Shopify rechazó la solicitud."
        });
      }

      /* ===================================
         RESPUESTA
      =================================== */

      const payload =
        data?.data
          ?.orderCreate;

      if (!payload) {
        console.error(
          "Shopify response:",
          data
        );

        return res.status(502).json({
          ok: false,

          message:
            "No se recibió una respuesta válida de Shopify."
        });
      }

      /* ===================================
         ERRORES SHOPIFY
      =================================== */

      if (
        payload.userErrors &&
        payload.userErrors.length
      ) {
        console.error(
          "Shopify userErrors:",
          payload.userErrors
        );

        return res.status(400).json({
          ok: false,

          message:
            payload.userErrors
              .map(
                (e) =>
                  e.message
              )
              .join(" ")
        });
      }

      /* ===================================
         PEDIDO NO CREADO
      =================================== */

      if (
        !payload.order
      ) {
        return res.status(502).json({
          ok: false,

          message:
            "Shopify no devolvió el pedido creado."
        });
      }

      /* ===================================
         ÉXITO
      =================================== */

      console.log(
        "================================="
      );

      console.log(
        "PEDIDO CREADO CORRECTAMENTE"
      );

      console.log(
        `Pedido: ${payload.order.name}`
      );

      console.log(
        `Pack: ${selected.label}`
      );

      console.log(
        `Precio: ${selected.price} Gs`
      );

      console.log(
        `Color: ${color}`
      );

      console.log(
        "================================="
      );

      return res.json({
        ok: true,

        order: {
          id:
            payload.order.id,

          name:
            payload.order.name
        }
      });

    } catch (err) {
      console.error(
        "ERROR GENERAL:",
        err
      );

      return res.status(500).json({
        ok: false,

        message:
          "No se pudo crear el pedido. Intenta nuevamente."
      });
    }
  }
);

/* =========================================
   SERVIR INDEX.HTML
========================================= */

app.use(
  express.static(
    __dirname
  )
);

app.use(
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

/* =========================================
   INICIAR SERVIDOR
========================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Cubre Canas app running on port ${PORT}`
    );

    console.log(
      "Precios configurados:"
    );

    packagesFromEnv()
      .forEach(
        (p) => {
          console.log(
            `${p.label}: ${p.price} Gs`
          );
        }
      );

    console.log(
      "Colores: Negro, Rojizo, Café"
    );
  }
);
