require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const SHOP_RAW = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const API_VERSION =
  process.env.SHOPIFY_API_VERSION || "2026-07";

const CURRENCY =
  process.env.SHOPIFY_CURRENCY || "PYG";


// =====================================================
// SHOPIFY SHOP
// Acepta:
// import-store-9250
// o
// import-store-9250.myshopify.com
// =====================================================

const SHOP = String(SHOP_RAW || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "")
  .replace(/\.myshopify\.com$/i, "");


// =====================================================
// VARIANTES DE CUBRE CANAS
// =====================================================

const COLOR_VARIANTS = {

  negro: "gid://shopify/ProductVariant/55924530151729",

  rojo: "gid://shopify/ProductVariant/55924530184497",

  cafe: "gid://shopify/ProductVariant/55924530217265"

};


// =====================================================
// TOKEN DE SHOPIFY
// =====================================================

let shopifyToken = null;
let shopifyTokenExpiresAt = 0;

async function getShopifyAccessToken() {

  if (
    !SHOP ||
    !CLIENT_ID ||
    !CLIENT_SECRET
  ) {

    throw new Error(
      "Faltan las credenciales de Shopify en Render."
    );

  }

  if (
    shopifyToken &&
    Date.now() < shopifyTokenExpiresAt
  ) {

    return shopifyToken;

  }


  const response = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
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

    console.error(
      "Error autenticando Shopify:",
      data
    );

    throw new Error(
      "Shopify no pudo generar el token de acceso."
    );

  }


  shopifyToken =
    data.access_token;


  const expiresIn =
    Number(data.expires_in) || 86399;


  shopifyTokenExpiresAt =
    Date.now() +
    Math.max(
      expiresIn - 300,
      60
    ) * 1000;


  console.log(
    "Token de Shopify obtenido correctamente."
  );


  return shopifyToken;

}


// =====================================================
// GRAPHQL SHOPIFY
// =====================================================

async function shopifyGraphQL(
  query,
  variables = {}
) {

  const token =
    await getShopifyAccessToken();


  const response =
    await fetch(
      `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "X-Shopify-Access-Token":
            token

        },

        body: JSON.stringify({

          query,

          variables

        })

      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    console.error(
      "Shopify HTTP error:",
      data
    );

    throw new Error(
      "Shopify rechazó la solicitud."
    );

  }


  if (data.errors?.length) {

    console.error(
      "Shopify GraphQL errors:",
      data.errors
    );

    throw new Error(
      data.errors
        .map(
          error =>
            error.message
        )
        .join(" ")
    );

  }


  return data.data;

}


// =====================================================
// PACKS
//
// Los precios se configuran en Render:
//
// PACKAGE_1_PRICE
// PACKAGE_2_PRICE
// PACKAGE_3_PRICE
//
// Los IDs de variante YA están en este código.
// =====================================================

function packagesFromEnv() {

  return [

    {
      id: "1",

      label:
        process.env.PACKAGE_1_LABEL ||
        "1 unidad",

      price:
        Number(
          process.env.PACKAGE_1_PRICE || 0
        )
    },

    {
      id: "2",

      label:
        process.env.PACKAGE_2_LABEL ||
        "2 unidades",

      price:
        Number(
          process.env.PACKAGE_2_PRICE || 0
        )
    },

    {
      id: "3",

      label:
        process.env.PACKAGE_3_LABEL ||
        "3 unidades",

      price:
        Number(
          process.env.PACKAGE_3_PRICE || 0
        )
    }

  ];

}


// =====================================================
// NORMALIZAR COLOR
// =====================================================

function normalizeColor(value) {

  const color =
    String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");


  if (
    color === "negro"
  ) {

    return "negro";

  }


  if (
    color === "rojo"
  ) {

    return "rojo";

  }


  if (
    color === "cafe" ||
    color === "café" ||
    color === "marron" ||
    color === "marrón"
  ) {

    return "cafe";

  }


  return null;

}


// =====================================================
// CONFIGURACIÓN PARA EL FORMULARIO
// =====================================================

app.get(
  "/api/config",
  (_req, res) => {

    const packages =
      packagesFromEnv();


    res.json({

      productName:
        process.env.PRODUCT_NAME ||
        "Cubre Canas",

      currency:
        CURRENCY,

      delivery:
        "Delivery gratis",

      payment:
        "Pago contra entrega",

      colors: [

        {
          id: "negro",
          label: "Negro"
        },

        {
          id: "rojo",
          label: "Rojo"
        },

        {
          id: "cafe",
          label: "Café"
        }

      ],

      packages

    });

  }
);


// =====================================================
// LIMPIAR DATOS
// =====================================================

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


// =====================================================
// VALIDAR PEDIDO
// =====================================================

function validateOrder(body) {

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


  if (
    !["1", "2", "3"]
      .includes(
        String(body.packageId)
      )
  ) {

    return "Cantidad no válida.";

  }


  if (
    !normalizeColor(body.color)
  ) {

    return "Selecciona un color válido.";

  }


  return null;

}


// =====================================================
// ORDER CREATE
// =====================================================

const ORDER_CREATE = `

mutation orderCreate(
  $order: OrderCreateOrderInput!
) {

  orderCreate(
    order: $order
  ) {

    userErrors {

      field

      message

    }

    order {

      id

      name

      displayFinancialStatus

      currentTotalPriceSet {

        shopMoney {

          amount

          currencyCode

        }

      }

    }

  }

}

`;


// =====================================================
// CREAR PEDIDO
// =====================================================

app.post(
  "/api/orders",
  async (req, res) => {

    try {

      // -------------------------------------------------
      // VALIDACIÓN
      // -------------------------------------------------

      const validationError =
        validateOrder(
          req.body
        );


      if (validationError) {

        return res
          .status(400)
          .json({

            ok: false,

            message:
              validationError

          });

      }


      // -------------------------------------------------
      // DATOS DEL CLIENTE
      // -------------------------------------------------

      const body =
        req.body;


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


      // -------------------------------------------------
      // COLOR
      // -------------------------------------------------

      const color =
        normalizeColor(
          body.color
        );


      const variantId =
        COLOR_VARIANTS[color];


      if (!variantId) {

        return res
          .status(400)
          .json({

            ok: false,

            message:
              "La variante del color seleccionado no existe."

          });

      }


      // -------------------------------------------------
      // PACK
      // -------------------------------------------------

      const packages =
        packagesFromEnv();


      const packageId =
        String(
          body.packageId
        );


      const selectedPackage =
        packages.find(
          item =>
            item.id ===
            packageId
        );


      if (!selectedPackage) {

        return res
          .status(400)
          .json({

            ok: false,

            message:
              "El pack seleccionado no existe."

          });

      }


      const quantity =
        Number(
          packageId
        );


      if (
        !selectedPackage.price ||
        selectedPackage.price <= 0
      ) {

        return res
          .status(500)
          .json({

            ok: false,

            message:
              "Falta configurar el precio del pack en Render."

          });

      }


      // -------------------------------------------------
      // PRECIO
      //
      // Shopify recibirá el precio TOTAL del pack
      // repartido entre las unidades.
      // -------------------------------------------------

      const unitPrice =
        selectedPackage.price /
        quantity;


      // -------------------------------------------------
      // PEDIDO
      // -------------------------------------------------

      const order = {

        lineItems: [

          {

            variantId,

            quantity,

            priceSet: {

              shopMoney: {

                amount:
                  unitPrice.toFixed(2),

                currencyCode:
                  CURRENCY

              }

            },

            customAttributes: [

              {

                key:
                  "Color",

                value:
                  color === "negro"
                    ? "Negro"
                    : color === "rojo"
                      ? "Rojo"
                      : "Café"

              },

              {

                key:
                  "Pack",

                value:
                  selectedPackage.label

              }

            ]

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


        ...(email
          ? {
              email
            }
          : {}),


        phone,


        // Pago contra entrega.
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

          "PEDIDO DESDE FORMULARIO CUBRE CANAS",

          `Color: ${
            color === "negro"
              ? "Negro"
              : color === "rojo"
                ? "Rojo"
                : "Café"
          }`,

          `Pack: ${
            selectedPackage.label
          }`,

          `Cantidad: ${
            quantity
          }`,

          `Total: ${
            selectedPackage.price
          } Gs`,

          "Delivery: GRATIS",

          "Pago: CONTRA ENTREGA",

          notes
            ? `Nota: ${notes}`
            : ""

        ]

          .filter(Boolean)

          .join(" | ")

      };


      // -------------------------------------------------
      // CREAR EN SHOPIFY
      // -------------------------------------------------

      const data =
        await shopifyGraphQL(
          ORDER_CREATE,
          {
            order
          }
        );


      const result =
        data?.orderCreate;


      if (!result) {

        return res
          .status(502)
          .json({

            ok: false,

            message:
              "Shopify no devolvió el resultado del pedido."

          });

      }


      // -------------------------------------------------
      // ERRORES DE SHOPIFY
      // -------------------------------------------------

      if (
        result.userErrors?.length
      ) {

        console.error(
          "Shopify userErrors:",
          result.userErrors
        );


        return res
          .status(400)
          .json({

            ok: false,

            message:
              result.userErrors
                .map(
                  error =>
                    error.message
                )
                .join(" ")

          });

      }


      // -------------------------------------------------
      // ÉXITO
      // -------------------------------------------------

      console.log(
        "PEDIDO CREADO:",
        result.order.name
      );


      return res.json({

        ok: true,

        order: {

          id:
            result.order.id,

          name:
            result.order.name,

          total:
            result.order
              .currentTotalPriceSet
              ?.shopMoney
              ?.amount,

          currency:
            result.order
              .currentTotalPriceSet
              ?.shopMoney
              ?.currencyCode

        }

      });


    } catch (error) {

      console.error(
        "ERROR CREANDO PEDIDO:",
        error
      );


      return res
        .status(500)
        .json({

          ok: false,

          message:
            error?.message ||
            "No se pudo crear el pedido."

        });

    }

  }
);


// =====================================================
// FRONTEND
// =====================================================

app.get(
  /.*/,
  (_req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);


// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(
  PORT,
  () => {

    console.log(
      `Cubre Canas app running on port ${PORT}`
    );

  }
);
