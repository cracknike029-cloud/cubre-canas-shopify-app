const order = {

  lineItems,


  customer:{

    toUpsert:{

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
    email ||
    undefined,
