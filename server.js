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

const CURRENCY =
  process.env.SHOPIFY_CURRENCY || "PYG";

const PRODUCT_NAME =
  process.env.PRODUCT_NAME || "Cubre Canas";

/* =====================================================
   PRECIOS
===================================================== */

const PACKAGES = [
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

/* =====================================================
   COLORES
===================================================== */

const COLORS = [
  "Negro",
  "Rojizo",
  "Café"
];

/* =====================================================
   TOKEN SHOPIFY
===================================================== */

let shopifyToken = null;
let shopifyTokenExpiresAt = 0;

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
      "Faltan las credenciales de Shopify en Render."
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

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Shopify devolvió una respuesta no válida: ${text.slice(0, 300)}`
    );
  }

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `Error de autenticación Shopify: ${JSON.stringify(data)}`
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

/* =====================================================
   SHOPIFY GRAPHQL
===================================================== */

async function shopifyGraphQL(
  query,
  variables = {}
) {
  const token =
    await getShopifyAccessToken();

  const response =
    await fetch(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "X-Shopify-Access-Token":
            token
        },

        body:
          JSON.stringify({
            query,
            variables
          })
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    throw new Error(
      `Shopify devolvió HTML o una respuesta no JSON: ${text.slice(0, 300)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Shopify HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data.errors) {
    throw new Error(
      data.errors
        .map(
          (error) =>
            error.message
        )
        .join(" | ")
    );
  }

  return data;
}

/* =====================================================
   CONFIG
===================================================== */

app.get(
  "/api/config",
  (_req, res) => {
    res.json({
      ok: true,

      productName:
        PRODUCT_NAME,

      currency:
        CURRENCY,

      delivery:
        "Delivery gratis",

      payment:
        "Pago contra entrega",

      packages:
        PACKAGES,

      colors:
        COLORS
    });
  }
);

/* =====================================================
   LIMPIAR
===================================================== */

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

/* =====================================================
   VALIDAR PEDIDO
===================================================== */

function validateOrder(
  body
) {
  const required = [
    "firstName",
    "lastName",
    "phone",
    "address",
    "city",
    "packageId",
    "color"
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

  const packageId =
    String(
      body.packageId
    );

  if (
    !["1", "2", "3"].includes(
      packageId
    )
  ) {
    return "Cantidad no válida.";
  }

  const color =
    clean(
      body.color,
      60
    );

  if (!color) {
    return "Selecciona un color.";
  }

  if (
    !COLORS.includes(
      color
    )
  ) {
    return (
      "Color no válido. " +
      "Selecciona Negro, Rojizo o Café."
    );
  }

  return null;
}

/* =====================================================
   BUSCAR VARIANTE
===================================================== */

const FIND_PRODUCTS = `
query FindProducts($query: String!) {
  products(first: 20, query: $query) {
    nodes {
      id
      title

      variants(first: 100) {
        nodes {
          id
          title
          price

          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
}
`;

async function findShopifyVariants() {
  const data =
    await shopifyGraphQL(
      FIND_PRODUCTS,
      {
        query:
          `title:${PRODUCT_NAME}`
      }
    );

  const products =
    data?.data?.products?.nodes ||
    [];

  if (
    !products.length
  ) {
    throw new Error(
      `No encontré "${PRODUCT_NAME}" en Shopify.`
    );
  }

  let product =
    products.find(
      (item) =>
        item.title
          .trim()
          .toLowerCase() ===
        PRODUCT_NAME
          .trim()
          .toLowerCase()
    );

  if (!product) {
    product =
      products[0];
  }

  const variants =
    product
      ?.variants
      ?.nodes || [];

  if (!variants.length) {
    throw new Error(
      `El producto "${product.title}" no tiene variantes.`
    );
  }

  console.log(
    "Producto Shopify:",
    product.title
  );

  console.log(
    "Variantes Shopify:"
  );

  variants.forEach(
    (variant) => {
      console.log(
        variant.title,
        "|",
        variant.price,
        "|",
        variant.id
      );
    }
  );

  return variants;
}

/* =====================================================
   ENCONTRAR VARIANTE DEL PACK
===================================================== */

function findVariant(
  variants,
  packageData
) {
  const number =
    packageData.id;

  /* Buscar por título */

  let variant =
    variants.find(
      (item) => {
        const title =
          item.title
            .toLowerCase();

        return (
          title.includes(
            number
          ) &&
          title.includes(
            "unidad"
          )
        );
      }
    );

  if (variant) {
    return variant;
  }

  /* Buscar por precio */

  variant =
    variants.find(
      (item) =>
        Number(
          item.price
        ) ===
        Number(
          packageData.price
        )
    );

  if (variant) {
    return variant;
  }

  /* Si solamente existe una variante */

  if (
    variants.length === 1
  ) {
    return variants[0];
  }

  return null;
}

/* =====================================================
   CREAR PEDIDO SHOPIFY
===================================================== */

const ORDER_CREATE = `
mutation CreateOrder(
  $order: OrderCreateOrderInput!
) {
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

/* =====================================================
   API PEDIDOS
===================================================== */

app.post(
  "/api/orders",
  async (req, res) => {

    /*
      IMPORTANTE:

      Esta ruta SIEMPRE intenta devolver JSON.
    */

    try {

      console.log(
        "================================="
      );

      console.log(
        "NUEVO PEDIDO RECIBIDO"
      );

      console.log(
        JSON.stringify(
          req.body,
          null,
          2
        )
      );

      /* --------------------------------
         CREDENCIALES
      -------------------------------- */

      if (
        !SHOP ||
        !CLIENT_ID ||
        !CLIENT_SECRET
      ) {
        return res.status(500).json({
          ok: false,

          message:
            "Shopify todavía no está configurado correctamente en Render."
        });
      }

      /* --------------------------------
         VALIDACIÓN
      -------------------------------- */

      const validation =
        validateOrder(
          req.body
        );

      if (validation) {
        return res.status(400).json({
          ok: false,
          message:
            validation
        });
      }

      /* --------------------------------
         DATOS
      -------------------------------- */

      const firstName =
        clean(
          req.body.firstName,
          80
        );

      const lastName =
        clean(
          req.body.lastName,
          80
        );

      const email =
        clean(
          req.body.email,
          160
        );

      const phone =
        clean(
          req.body.phone,
          40
        );

      const address =
        clean(
          req.body.address,
          180
        );

      const city =
        clean(
          req.body.city,
          80
        );

      const color =
        clean(
          req.body.color,
          60
        );

      const notes =
        clean(
          req.body.notes,
          500
        );

      /* --------------------------------
         PAQUETE
      -------------------------------- */

      const packageData =
        PACKAGES.find(
          (item) =>
            item.id ===
            String(
              req.body.packageId
            )
        );

      if (!packageData) {
        return res.status(400).json({
          ok: false,

          message:
            "El paquete seleccionado no existe."
        });
      }

      /* --------------------------------
         VARIANTES
      -------------------------------- */

      const variants =
        await findShopifyVariants();

      const variant =
        findVariant(
          variants,
          packageData
        );

      if (!variant) {

        return res.status(400).json({
          ok: false,

          message:
            `No encontré una variante de Shopify para ${packageData.label}.`
        });
      }

      /* --------------------------------
         PEDIDO
      -------------------------------- */

      const order = {

        lineItems: [
          {
            variantId:
              variant.id,

            /*
              IMPORTANTE:
              cada opción ya representa
              un pack completo.
            */

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

          `Cantidad: ${packageData.label}`,

          `Precio: ${packageData.price} Gs`,

          `Color: ${color}`,

          "Delivery: gratis",

          "Pago: contra entrega",

          notes
            ? `Observaciones: ${notes}`
            : ""
        ]
          .filter(Boolean)
          .join(
            " | "
          )
      };

      /* --------------------------------
         LOG
      -------------------------------- */

      console.log(
        "Cliente:",
        firstName,
        lastName
      );

      console.log(
        "Paquete:",
        packageData.label
      );

      console.log(
        "Precio:",
        packageData.price
      );

      console.log(
        "Color:",
        color
      );

      console.log(
        "Variant:",
        variant.id
      );

      /* --------------------------------
         SHOPIFY
      -------------------------------- */

      const data =
        await shopifyGraphQL(
          ORDER_CREATE,
          {
            order
          }
        );

      const result =
        data?.data?.orderCreate;

      if (!result) {

        console.error(
          "Respuesta inválida:",
          data
        );

        return res.status(502).json({
          ok: false,

          message:
            "Shopify no devolvió información del pedido."
        });
      }

      /* --------------------------------
         ERRORES SHOPIFY
      -------------------------------- */

      if (
        result.userErrors &&
        result.userErrors.length
      ) {

        const message =
          result.userErrors
            .map(
              (error) =>
                error.message
            )
            .join(
              " | "
            );

        console.error(
          "Shopify rechazó:",
          message
        );

        return res.status(400).json({
          ok: false,

          message
        });
      }

      /* --------------------------------
         PEDIDO CREADO
      -------------------------------- */

      if (!result.order) {

        return res.status(502).json({
          ok: false,

          message:
            "Shopify no creó el pedido."
        });
      }

      console.log(
        "PEDIDO CREADO:",
        result.order.name
      );

      console.log(
        "================================="
      );

      return res.status(200).json({

        ok: true,

        message:
          "Pedido creado correctamente.",

        order: {
          id:
            result.order.id,

          name:
            result.order.name
        }
      });

    } catch (error) {

      console.error(
        "ERROR AL CREAR PEDIDO:"
      );

      console.error(
        error
      );

      /*
        MUY IMPORTANTE:
        incluso si algo falla,
        devolvemos JSON.
      */

      return res.status(500).json({

        ok: false,

        message:
          error?.message ||
          "Ocurrió un error al crear el pedido."
      });
    }
  }
);

/* =====================================================
   ERRORES JSON DE API
===================================================== */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      ok: false,

      message:
        "Ruta API no encontrada."
    });
  }
);

/* =====================================================
   ARCHIVOS DEL FORMULARIO
===================================================== */

app.use(
  express.static(
    __dirname
  )
);

/* =====================================================
   FALLBACK HTML
===================================================== */

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

/* =====================================================
   SERVIDOR
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      `Cubre Canas app running on port ${PORT}`
    );

    console.log(
      `Producto: ${PRODUCT_NAME}`
    );

    console.log(
      "Precios:"
    );

    PACKAGES.forEach(
      (item) => {

        console.log(
          `${item.label}: ${item.price} Gs`
        );

      }
    );

    console.log(
      "Colores: Negro, Rojizo, Café"
    );

    console.log(
      "================================="
    );
  }
);
