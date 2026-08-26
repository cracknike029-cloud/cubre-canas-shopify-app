require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

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


/* =====================================================
   OBTENER TOKEN DE SHOPIFY AUTOMÁTICAMENTE
===================================================== */

async function getShopifyAccessToken() {

  if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {

    throw new Error(
      "Faltan SHOPIFY_SHOP, SHOPIFY_CLIENT_ID o SHOPIFY_CLIENT_SECRET en Render."
    );

  }

  if (
    shopifyToken &&
    Date.now() < shopifyTokenExpiresAt
  ) {

    return shopifyToken;

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

    console.error(
      "Shopify authentication error:",
      data
    );

    throw new Error(
      "Shopify no pudo generar el token de acceso."
    );

  }


  shopifyToken =
    data.access_token;


  const expiresIn =
    Number(data.expires_in) || 86400;


  shopifyTokenExpiresAt =
    Date.now() +
    Math.max(
      expiresIn - 300,
      60
    ) * 1000;


  return shopifyToken;

}


/* =====================================================
   FUNCIÓN PARA HABLAR CON SHOPIFY
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


/* =====================================================
   PACKS
===================================================== */

function packagesFromEnv() {

  return [1, 2, 3].map(
    n => ({

      id:
        String(n),

      label:
        process.env[
          `PACKAGE_${n}_LABEL`
        ] ||
        `${n} unidad${
          n > 1 ? "es" : ""
        }`,

      price:
        Number(
          process.env[
            `PACKAGE_${n}_PRICE`
          ] || 0
        ),

      variantId:
        process.env[
          `PACKAGE_${n}_VARIANT_ID`
        ] || ""

    })
  );

}


/* =====================================================
   CONFIGURACIÓN DEL FORMULARIO
===================================================== */

app.get(
  "/api/config",
  (_req, res) => {

    const packages =
      packagesFromEnv()
        .map(
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


/* =====================================================
   LIMPIAR DATOS
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
        String(
          body.packageId
        )
      )
  ) {

    return "Cantidad no válida.";

  }


  if (
    !clean(
      body.color,
      60
    )
  ) {

    return "Selecciona un color.";

  }


  return null;

}


/* =====================================================
   MUTACIÓN PARA CREAR PEDIDO
===================================================== */

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


/* =====================================================
   CREAR PEDIDO
===================================================== */

app.post(
  "/api/orders",
  async (req, res) => {

    try {

      const error =
        validateOrder(
          req.body
        );


      if (error) {

        return res
          .status(400)
          .json({

            ok: false,

            message: error

          });

      }


      const body =
        req.body;


      const packages =
        packagesFromEnv();


      const selected =
        packages.find(
          packageItem =>
            packageItem.id ===
            String(
              body.packageId
            )
        );


      if (
        !selected ||
        !selected.variantId
      ) {

        return res
          .status(500)
          .json({

            ok: false,

            message:
              "Falta configurar la variante de Shopify para esta cantidad."

          });

      }


      if (
        !selected.price ||
        selected.price <= 0
      ) {

        return res
          .status(500)
          .json({

            ok: false,

            message:
              "Falta configurar el precio de este pack en Render."

          });

      }


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
        );


      const quantity =
        Number(
          body.packageId
        );


      /*
        Precio total del pack dividido
        entre las unidades.

        Ejemplo:

        Pack 2 =
        321.100 Gs

        Pack 3 =
        456.300 Gs
      */

      const unitPrice =
        selected.price /
        quantity;


      const order = {

        lineItems: [

          {

            variantId:
              selected.variantId,

            quantity,

            priceSet: {

              shopMoney: {

                amount:
                  unitPrice.toFixed(2),

                currencyCode:
                  DEFAULT_CURRENCY

              }

            },

            properties: [

              {

                name:
                  "Color",

                value:
                  color

              },

              {

                name:
                  "Pack",

                value:
                  selected.label

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


        /*
          Pago contra entrega.
        */

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

          "PEDIDO CUBRE CANAS",

          `Color: ${color}`,

          `Pack: ${selected.label}`,

          `Cantidad: ${quantity}`,

          "Delivery: GRATIS",

          "Pago: CONTRA ENTREGA",

          notes
            ? `Nota: ${notes}`
            : ""

        ]

          .filter(Boolean)

          .join(" | ")

      };


      const data =
        await shopifyGraphQL(
          ORDER_CREATE,
          {
            order
          }
        );


      const payload =
        data?.orderCreate;


      if (!payload) {

        return res
          .status(502)
          .json({

            ok: false,

            message:
              "Shopify no devolvió el resultado del pedido."

          });

      }


      if (
        payload.userErrors?.length
      ) {

        console.error(
          "Shopify userErrors:",
          payload.userErrors
        );


        return res
          .status(400)
          .json({

            ok: false,

            message:
              payload.userErrors
                .map(
                  error =>
                    error.message
                )
                .join(" ")

          });

      }


      return res.json({

        ok: true,

        order: {

          id:
            payload.order.id,

          name:
            payload.order.name,

          total:
            payload.order
              .currentTotalPriceSet
              ?.shopMoney
              ?.amount

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


/* =====================================================
   MOSTRAR FORMULARIO
===================================================== */

app.get(
  "*",
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


/* =====================================================
   INICIAR SERVIDOR
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      `Cubre Canas app running on port ${PORT}`
    );

  }
);
