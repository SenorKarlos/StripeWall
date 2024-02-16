var bot, database, maintenance, oauth, qbo, qboData;
const moment = require('moment');
const config = require("../config/config.json");
const stripe_js = require('stripe')(config.stripe.live_sk, {
  apiVersion: '2022-11-15',
});
const stripe = {
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER FUNCTIONS
//------------------------------------------------------------------------------
  customer: {
//------------------------------------------------------------------------------
//  CREATE A CUSTOMER
//------------------------------------------------------------------------------
    create: function(body) {
      return new Promise(function(resolve) {
        stripe_js.customers.create(
        body,
        function(err, customer) {
          if (err) {
            console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Creating Customer.', err.message);
            return resolve('ERROR');
          }
          else {
            console.info('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.name+' ('+customer.description+' | '+customer.id+') has been Created.');
            return resolve(customer);
          }
        });
      });
    },
//------------------------------------------------------------------------------
//  UPDATE A CUSTOMER
//------------------------------------------------------------------------------
    update: function(customer_id, body) {
      return new Promise(function(resolve) {
        stripe_js.customers.update(
          customer_id,
          body,
          function(err, customer) {
            if (err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Updating Customer.', err.message);
              return resolve('ERROR');
            }
            else {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.name+' ('+customer.description+' | '+customer.id+') has been Updated.');
              return resolve(customer);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  FETCH A CUSTOMER
//------------------------------------------------------------------------------
    fetch: function(customer_id) {
      return new Promise(function(resolve) {
        stripe_js.customers.retrieve(
          customer_id, { expand: ['subscriptions.data', 'subscriptions.data.latest_invoice'], },
          function(err, customer) {
            if (err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Fetching Customer.', err.message);
              return resolve('ERROR');
            }
            else {
              return resolve(customer);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  DELETE A CUSTOMER
//------------------------------------------------------------------------------
    delete: function(customer_id, name, discord_id) {
      return new Promise(function(resolve) {
        stripe_js.customers.del(
          customer_id,
          function(err, confirmation) {
            if (err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Deleting Customer.', err.message);
              return resolve('ERROR');
            }
            else {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+name+' ('+discord_id+' | '+customer_id+') has been Deleted.');
              return resolve(confirmation);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  LIST ALL ACTIVE CUSTOMERS
//------------------------------------------------------------------------------
    list: async function() {
      let list = [];
      for await (const customer of stripe_js.customers.list({ limit: 100, expand: ['data.subscriptions', 'data.subscriptions.data.latest_invoice'] })) {
        list.push(customer);
      } return list;
    }
  },
//------------------------------------------------------------------------------
//  STRIPE SUBSCRIPTION FUNCTIONS
//------------------------------------------------------------------------------
  subscription: {
//------------------------------------------------------------------------------
//  CANCEL A SUSBCRIPTION
//------------------------------------------------------------------------------
    cancel: function(username, user_id, subscription_id){
      return new Promise(function(resolve) {
        stripe_js.subscriptions.del(
          subscription_id,
          function(err, confirmation) {
            if (err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Canceling Subscription.', err.message);
              return resolve(null);
            }
            else {
              bot.sendEmbed(username, user_id, 'FF0000', 'Subscription Cancellation', '', config.discord.log_channel);
              console.info("["+bot.getTime("stamp")+"] [stripe.js] "+username+"'s subscription has been cancelled due to leaving the Server.");
              return resolve(confirmation);
            }
          }
        );
      });
    }
  },
//------------------------------------------------------------------------------
//  STRIPE SESSION FUNCTIONS
//------------------------------------------------------------------------------
  sessions: {
//------------------------------------------------------------------------------
//  CHECKOUT
//------------------------------------------------------------------------------
    checkout: async function(req, res) {
      let values ;
      if (req.body.checkout) {
        values = req.body.checkout.split(":");
      }
      else {
        values = req.body.donate.split(":");
      }
      let customerID = values[0];
      let priceID = values[1];
      let mode = values[2];
      let type = values[3];
      let body = {
        mode: mode,
        customer: customerID,
        line_items: [
          {
            price: priceID,
            quantity: 1,
          },
        ],
        success_url: config.pages.checkout.success_url,
        cancel_url: config.pages.checkout.cancel_url,
      };
      if (config.stripe.taxes.active) {
        if (config.stripe.taxes.automatic) {
          body.automatic_tax = { enabled: true };
        }
        else if (config.stripe.taxes.dynamic) {
          body.line_items[0].dynamic_tax_rates = config.stripe.taxes.rate_ids;
        }
        else {
          body.line_items[0].tax_rates = config.stripe.taxes.rate_ids;
        }
      }
      if (type == 'services' && mode == 'payment') {
        body.payment_intent_data = { statement_descriptor: config.stripe.service_product_descriptor }
      }
      if (type == 'donation' && mode == 'payment') {
        body.payment_intent_data = { statement_descriptor: config.stripe.donation_product_descriptor }
      }
      if (type == 'donation' && mode == 'subscription') {
        body.line_items[0].adjustable_quantity = {
          enabled: true,
          minimum: 1,
          maximum: 199999
        }
      }
      if (config.stripe.addresses.billing) {
        body.billing_address_collection = "required";
        body.customer_update = {address: "auto"};
      }
      if (config.stripe.addresses.shipping.length > 0) {
        body.shipping_address_collection = {allowed_countries: config.stripe.addresses.shipping};
        if (body.customer_update.address) {
          body.customer_update.shipping = "auto";
        }
        else {
          body.customer_update = {shipping: "auto"};
        }
      }
      try {
        let session = await stripe_js.checkout.sessions.create(body);
        return res.redirect(303, session.url);
      } catch (e) {
        res.status(400);
        return res.send({
          error: {
            message: e.message,
          }
        });
      }
    },
//------------------------------------------------------------------------------
//  CUSTOMER PORTAL
//------------------------------------------------------------------------------
    portal: async function(req, res) {
      try {
        let customerID = req.body.customerID;
        let session = await stripe_js.billingPortal.sessions.create({
          customer: customerID,
          return_url: config.server.site_url,
        });
        return res.redirect(session.url);
      } catch (e) {
        res.status(400);
        return res.send({
          error: {
            message: e.message,
          }
        });
      }
    },
    fetchCheckout: function(checkout_id) {
      return new Promise(function(resolve) {
        stripe_js.checkout.sessions.retrieve(
          checkout_id, { expand: ['line_items.data','payment_intent','payment_intent.latest_charge'], },
          function(err, checkout) {
            if (err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Fetching Checkout.', err.message);
              return resolve('ERROR');
            }
            else {
              return resolve(checkout);
            }
          }
        );
      });
    }
  },
//------------------------------------------------------------------------------
//  STRIPE WEBHOOK FUNCTIONS
//------------------------------------------------------------------------------
  webhookVerify: async function(req, res) {
    let data;
    let eventType;
    if (config.stripe.wh_secret) {
      let event;
      let signature = req.headers["stripe-signature"];
      try {
        event = stripe_js.webhooks.constructEvent(
          req.rawBody,
          signature,
          config.stripe.wh_secret
        );
      } catch (e) {
        console.info("["+bot.getTime('stamp')+"] ⚠️  Webhook signature verification failed.", e);
        return res.sendStatus(400);
      }
      data = event.data;
      eventType = event.type;
    }
    else {
      data = req.body.data;
      eventType = req.body.type;
    }
    res.sendStatus(200);
    return stripe.webhookParse(data, eventType);
  },
  webhookParse: async function(data, eventType) {
    let customer, dbuser, member, checkout, cx_type, type_text, total_spend, total_votes, tax_info = ' ', charge_list = [], fee_amount = 0, tax_amount = 0, tax_rate = 0, expiry = null, percentage = 0, charge_found = false;
    switch (eventType) {
//------------------------------------------------------------------------------
//   CUSTOMER CREATED
//------------------------------------------------------------------------------
      case 'customer.created':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Customer Created Webhook received for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        dbuser = await database.fetchUser(data.object.description);
        if (!dbuser) {
          let saved = await database.runQuery(`INSERT INTO customers (user_id, user_name, email, stripe_data) VALUES (?, ?, ?, ?)`, [data.object.description, data.object.name, JSON.stringify(data.object)]);
          if (!saved) { 
            console.info('['+bot.getTime('stamp')+'] [database.js] Database insert failure, logging Data for manual update and/or admin investigation.');
            console.info('Data:', data);
            return;
          }
          return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database record created for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        }
        if (!dbuser.stripe_data || dbuser.stripe_data && dbuser.stripe_data.id != data.object.id) {
          let saved = await database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(data.object), data.object.description]);
          if (!saved) { 
            console.info('['+bot.getTime('stamp')+'] [database.js] Database update failure, logging Data for manual update and/or admin investigation.');
            console.info('Data:', data);
            return;
          }
          return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database record created for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        }
        return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database record found with matching stripe info.');

//------------------------------------------------------------------------------
//   CUSTOMER UPDATED
//------------------------------------------------------------------------------
      case 'customer.updated':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Customer Updated Webhook received for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        dbuser = await database.fetchUser(data.object.description, data.object.id);
        switch (true) {
          case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !config.stripe.taxes.active: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Taxes are not active, nothing to change');
          default:
            if (data.previous_attributes.address && data.object.address && data.previous_attributes.address.state != data.object.address.state) {
              for (let t = 0; t < config.stripe.taxes.rate_maps.length; t++) {
                for (let r = 0; r < config.stripe.taxes.rate_maps[t].jurisdiction.length; r++) {
                  if (data.object.address.state == config.stripe.taxes.rate_maps[t].jurisdiction[r]) {
                    tax_rate = config.stripe.taxes.rate_maps[t].tax_rate;
                  }
                }
              }
              database.runQuery(`UPDATE customers SET tax_rate = ? WHERE user_id = ?`, [tax_rate, dbuser.user_id]);
              return bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', '📋 Stripe Customer Changed Tax Jurisdiction.', 'Updated Tax information.', config.discord.log_channel);
            }
            else {
              return console.info('['+bot.getTime('stamp')+'] [stripe.js] Tax jurisdiction same, nothing to change');
            }
        }
//------------------------------------------------------------------------------
//   CUSTOMER DELETED
//------------------------------------------------------------------------------
      case 'customer.deleted':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Customer Deleted Webhook received for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        dbuser = await database.fetchUser(data.object.description, data.object.id);
        switch(true){
          case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          default:
            if (dbuser.customer_type == 'subscriber' || dbuser.customer_type == 'pay-as-you-go') {
              if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
              dbuser.customer_type = 'inactive';
            }
            database.runQuery(`UPDATE customers SET customer_type = ?, stripe_data = NULL WHERE user_id = ?`, [dbuser.customer_type, dbuser.user_id]);
            return bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', '📋 Stripe Customer Deleted.', 'Deleted Stripe information.', config.discord.log_channel);
        }
//------------------------------------------------------------------------------
//   CHECKOUT SESSION COMPLETED
//------------------------------------------------------------------------------
      case 'checkout.session.completed':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Checkout Session Completed Webhook received for '+data.object.customer);
        if (data.object.mode == 'setup') {
          console.info('['+bot.getTime('stamp')+'] [stripe.js] StripeWall is not configured for setup type checkouts. If you get this message, please make a GitHub Report. Logging request.');
          return console.info(data);
        }
        customer = await stripe.customer.fetch(data.object.customer);
        dbuser = await database.fetchUser(customer.description);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        checkout = await stripe.sessions.fetchCheckout(data.object.id);
        fee_amount = data.object.amount_subtotal / 100;
        if (config.stripe.taxes.active) {
          if (data.object.total_details.amount_tax > 0) {
            tax_amount = parseFloat(data.object.total_details.amount_tax/100).toFixed(2);
            tax_rate = parseFloat(data.object.total_details.amount_tax/data.object.amount_subtotal).toFixed(2);
          }
          else {
            tax_amount = parseFloat(0).toFixed(2);
            tax_rate = 0;
          }
          tax_info = '**(Fee: $'+parseFloat(fee_amount).toFixed(2)+', Tax: $'+tax_amount+')**';
        }
        switch(true){
          case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild during Checkout. Replay the webhook from your Stripe Dashboard after you deal with that.');
          default:
            total_spend = dbuser.total_spend + fee_amount;
            if (config.service_zones.votes_enabled) {
              total_votes = Math.floor(total_spend / config.service_zones.vote_worth) + 1;
            }
            else {
              total_votes = dbuser.total_votes;
            }
            let charge_id;
            if (!checkout.payment_intent) {
              for (let x = 0; x < customer.subscriptions.data.length; x++) {
                if (customer.subscriptions.data[x].items.data[0].price.id == checkout.line_items.data[0].price.id) {
                  charge_id = customer.subscriptions.data[x].latest_invoice.charge;
                }
              }
            }
            else {
              charge_id = checkout.payment_intent.latest_charge.id;
            }
            if (dbuser.charge_list) {
              charge_list = dbuser.charge_list;
              charge_list.splice(0, 0, { id: charge_id });
            }
            else {
              charge_list[0] = { id: charge_id };
            }
            for (let i = 0; i < config.stripe.price_ids.length; i++) {
              if (checkout.line_items.data[0].price.id == config.stripe.price_ids[i].id) {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name, dbuser.access_token);
                if (config.service_zones.roles_enabled && dbuser.customer_type == 'inactive' || dbuser.customer_type == 'lifetime-inactive') { 
                  await database.updateZoneRoles(dbuser.user_id, '');
                }
                let welcome = config.discord.purchase_welcome.replace('%usertag%', '<@'+dbuser.user_id+'>');
                welcome = welcome.replace('%site_url%', config.server.site_url);
                bot.channels.cache.get(config.discord.welcome_channel)
                  .send(welcome)
                  .catch(console.info);
                if (config.qbo.enabled) {
                  // create invoice
                  // pay invoice to stripe holding
                  // maybe compare total spend to qbo if easy enough
                }
                if (data.object.mode == 'subscription') {
                  dbuser.paygo_data = null;
                  cx_type = 'subscriber';
                  type_text = '✅ Subscription Creation Payment to';
                }
                else if (data.object.mode == 'payment') {
                  if (dbuser.paygo_data && dbuser.paygo_data.expiration && dbuser.paygo_data.expiration > checkout.payment_intent.latest_charge.created) {
                    expiry = dbuser.paygo_data.expiration + config.stripe.price_ids[i].expiry;
                  }
                  else {
                    expiry = checkout.payment_intent.latest_charge.created + config.stripe.price_ids[i].expiry;
                  }
                  dbuser.paygo_data = {};
                  dbuser.paygo_data.price_id = config.stripe.price_ids[i].id;
                  dbuser.paygo_data.expiration = expiry;
                  dbuser.paygo_data.source = 'stripe';
                  cx_type = 'pay-as-you-go';
                  type_text = '✅ Pay-As-You-Go Access Payment to';
                }
                if (dbuser.paygo_data) {
                  dbuser.paygo_data = JSON.stringify(dbuser.paygo_data);
                }
                if (dbuser.customer_type == 'administrator') { cx_type = 'administrator'; }
                bot.sendDM(member, type_text+' '+config.server.site_name+' Successful! 💰', 'Amount: **$'+parseFloat(data.object.amount_total / 100).toFixed(2)+'** '+tax_info, '00FF00');
                bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', type_text+' '+config.server.site_name+' Successful! 💰', 'Amount: **$'+parseFloat(data.object.amount_total / 100).toFixed(2)+'** '+tax_info, config.discord.log_channel);
                await database.runQuery(`UPDATE customers SET customer_type = ?, stripe_data = ?, paygo_data = ?, total_spend = ?, total_votes = ?, tax_rate = ?, charge_list = ? WHERE user_id = ?`, [cx_type, JSON.stringify(customer), dbuser.paygo_data, total_spend, total_votes, tax_rate, JSON.stringify(charge_list), dbuser.user_id]);
                if (dbuser.total_votes < total_votes) {
                  if (dbuser.format === 1) {
                    for (let a = 0; a < dbuser.allocations.length; a++) {
                      percentage = percentage + dbuser.allocations[a].percent;
                    }
                    await database.allocateVotes(dbuser.user_id, dbuser.allocations, percentage);
                    bot.sendDM(member, 'New Votes Added and Allocated ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to check amounts!','00FF00');
                    bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'New Votes Added and Allocated ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
                  }
                  else {
                    bot.sendDM(member, 'New Votes Added to Allocate ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to assign them!','00FF00');
                    bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'New Votes Added to Allocate ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
                  }
                }
                return;
              }
            }
            for (let d = 0; d < config.stripe.donation_ids.length; d++) {
              if (checkout.line_items.data[0].price.id == config.stripe.donation_ids[d].id) {
                if (!dbuser.donation_data) {
                  dbuser.donation_data = {};
                  dbuser.donation_data.counter = 1;
                  dbuser.donation_data.total = fee_amount;
                  dbuser.donation_data.role_ids = ["", ""];
                }
                else {
                  dbuser.donation_data.counter = dbuser.donation_data.counter + 1;
                  dbuser.donation_data.total = dbuser.donation_data.total + fee_amount;
                }
                if (config.stripe.donation_ids[d].role_id) {
                  await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.donation_ids[d].role_id, dbuser.user_name, dbuser.access_token);
                  if (data.object.mode == 'subscription') {
                    dbuser.donation_data.role_ids[0] = config.stripe.donation_ids[d].role_id;
                  }
                  else if (data.object.mode == 'payment') {
                    dbuser.donation_data.role_ids[1] = config.stripe.donation_ids[d].role_id;
                  }
                }
                let welcome = config.discord.donation_welcome.replace('%usertag%', '<@'+dbuser.user_id+'>');
                welcome = welcome.replace('%site_url%', config.server.site_url);
                bot.channels.cache.get(config.discord.welcome_channel)
                  .send(welcome)
                  .catch(console.info);
                if (config.qbo.enabled) {
                  // create invoice
                  // pay invoice to stripe holding
                  // maybe compare total spend to qbo if easy enough
                }
                if (data.object.mode == 'subscription') {
                  type_text = '✅ Donation Subscription Creation Payment to';
                }
                else if (data.object.mode == 'payment') {
                  type_text = '✅ One-Time Donation Payment to';
                }
                bot.sendDM(member, type_text+' '+config.server.site_name+' Successful! 💰', 'Amount: **$'+parseFloat(data.object.amount_total / 100).toFixed(2)+'** '+tax_info, '00FF00');
                bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', type_text+' '+config.server.site_name+' Successful! 💰', 'Amount: **$'+parseFloat(data.object.amount_total / 100).toFixed(2)+'** '+tax_info, config.discord.log_channel);
                await database.runQuery(`UPDATE customers SET total_spend = ?, total_votes = ?, stripe_data = ?, donation_data = ?, charge_list = ? WHERE user_id = ?`, [total_spend, total_votes, JSON.stringify(customer), JSON.stringify(dbuser.donation_data), JSON.stringify(charge_list), dbuser.user_id]);                
                if (dbuser.total_votes < total_votes) {
                  if (dbuser.format === 1) {
                    for (let a = 0; a < dbuser.allocations.length; a++) {
                      percentage = percentage + dbuser.allocations[a].percent;
                    }
                    await database.allocateVotes(dbuser.user_id, dbuser.allocations, percentage);
                    bot.sendDM(member, 'New Votes Added and Allocated ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to check amounts!', '00FF00');
                    bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'New Votes Added and Allocated ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
                  }
                  else {
                    bot.sendDM(member, 'New Votes Added to Allocate ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to assign them!', '00FF00');
                    bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'New Votes Added to Allocate ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
                  }
                }                
                return;
              }
            }
        } return;
//------------------------------------------------------------------------------
//   CHARGE SUCCEEDED
//------------------------------------------------------------------------------
      case 'charge.succeeded':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Successful Charge webhook for '+data.object.customer);
        setTimeout(async function() {
          customer = await stripe.customer.fetch(data.object.customer);
          dbuser = await database.fetchUser(customer.description);
          member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
          switch(true){
            case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
            case (data.object.calculated_statement_descriptor != config.stripe.service_product_descriptor && data.object.calculated_statement_descriptor != config.stripe.donation_product_descriptor):
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Charge webhook for '+data.object.customer+' is not in the bot scope. Logging request for review');
              console.info(data);
              return bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'Charge webhook for '+data.object.customer+' is not in the bot scope.', 'Logging request for review', config.discord.log_channel);
            default:
              if (dbuser.charge_list) {
                charge_list = dbuser.charge_list;
                charge_list.forEach((charge, i) => {
                  if (charge.id == data.object.id) {
                    charge_list[i] = data.object;
                    charge_found = true;
                    console.info('['+bot.getTime('stamp')+'] [stripe.js] Charge has been handled previously, likely checkout, updated record.');
                  }
                });
                if (!charge_found) { charge_list.splice(0, 0, data.object); }
              }
              else {
                charge_list[0] = data.object;
              }
              if (!charge_found) {
                if (data.object.calculated_statement_descriptor == config.stripe.service_product_descriptor) {
                  if (config.stripe.taxes.active) {
                    if (dbuser.tax_rate === 0 || !dbuser.tax_rate) { return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has no tax rate but taxes enabled. Replay the webhook from your Stripe Dashboard after you deal with that.'); }
                    fee_amount = Math.round(data.object.amount / (dbuser.tax_rate + 1));
                    tax_amount = (data.object.amount - fee_amount) / 100;
                    fee_amount = fee_amount / 100;
                  }
                  else {
                    fee_amount = data.object.amount / 100;
                    tax_amount = 0;
                  }
                  type_text = '✅ Services Payment to '+config.server.site_name+' Successful! 💰';
                }
                else if (data.object.calculated_statement_descriptor == config.stripe.donation_product_descriptor) {
                  fee_amount = data.object.amount / 100;
                  tax_amount = 0;
                  type_text = '✅ Donation Payment to '+config.server.site_name+' Successful! 💰';
                  if (!dbuser.donation_data) {
                    dbuser.donation_data = {};
                    dbuser.donation_data.counter = 1;
                    dbuser.donation_data.total = fee_amount;
                    dbuser.donation_data.role_ids = ["", ""];
                  }
                  else {
                    dbuser.donation_data.counter = dbuser.donation_data.counter + 1;
                    dbuser.donation_data.total = dbuser.donation_data.total + fee_amount;
                  }
                }
                tax_info = '**(Fee: $'+parseFloat(fee_amount).toFixed(2)+', Tax: $'+parseFloat(tax_amount).toFixed(2)+')**';
                if (member) { bot.sendDM(member, type_text, 'Amount: **$'+parseFloat(data.object.amount / 100).toFixed(2)+'** '+tax_info, '00FF00'); }
                bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', type_text, 'Amount: **$'+parseFloat(data.object.amount / 100).toFixed(2)+'** '+tax_info, config.discord.log_channel);
                total_spend = dbuser.total_spend + fee_amount;
                if (config.service_zones.votes_enabled) {
                  total_votes = Math.floor(total_spend / config.service_zones.vote_worth) + 1;
                }
                else {
                  total_votes = dbuser.total_votes;
                }
                if (config.qbo.enabled) {
                  // create invoice
                  // pay invoice to stripe holding
                  // maybe compare total spend to qbo if easy enough
                }
              }
              else {
                total_spend = dbuser.total_spend;
                total_votes = dbuser.total_votes;
              }
              if (dbuser.donation_data) {
                dbuser.donation_data = JSON.stringify(dbuser.donation_data);
              }
              database.runQuery(`UPDATE customers SET stripe_data = ?, donation_data = ?, charge_list = ?, total_spend = ?, total_votes = ? WHERE user_id = ?`, [JSON.stringify(customer), dbuser.donation_data, JSON.stringify(charge_list), total_spend, total_votes, dbuser.user_id]);
              if (dbuser.total_votes < total_votes) {
                if (dbuser.format === 1) {
                  for (let a = 0; a < dbuser.allocations.length; a++) {
                    percentage = percentage + dbuser.allocations[a].percent;
                  }
                  await database.allocateVotes(dbuser.user_id, dbuser.allocations, percentage);
                  bot.sendDM(member, 'New Votes Added and Allocated ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to check amounts!','00FF00');
                  bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'New Votes Added and Allocated ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
                }
                else {
                  bot.sendDM(member, 'New Votes Added to Allocate ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to assign them!','00FF00');
                  bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'New Votes Added to Allocate ✅', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
                }
              }
          }
        }, 5000); return;
//------------------------------------------------------------------------------
//   CHARGE REFUNDED
//------------------------------------------------------------------------------
      case 'charge.refunded':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Charge Refund webhook for '+data.object.customer);
        customer = await stripe.customer.fetch(data.object.customer);
        dbuser = await database.fetchUser(customer.description);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        switch(true){
          case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case (data.object.calculated_statement_descriptor != config.stripe.service_product_descriptor && data.object.calculated_statement_descriptor != config.stripe.donation_product_descriptor):
            console.info('['+bot.getTime('stamp')+'] [stripe.js] Charge refund webhook for '+data.object.customer+' is not in the bot scope. Logging request for review');
            console.info(data);
            return bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'Charge refund webhook for '+data.object.customer+' is not in the bot scope.', 'Logging request for review', config.discord.log_channel);
          default:
            if (dbuser.charge_list) {
              charge_list = dbuser.charge_list;
              charge_list.forEach((charge, i) => {
                if (charge.id == data.object.id) {
                  charge_list[i] = data.object;
                  charge_found = true;
                  console.info('['+bot.getTime('stamp')+'] [stripe.js] Charge Refund id '+data.object.id+' for '+dbuser.user_name+', '+dbuser.user_id+', '+data.object.customer+' found, updated record. Admins should verify if any service or donation roles require removal, or status changed.');
                  bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'Charge Refund id '+data.object.id+' for '+data.object.customer+' found, updated record.', 'Admins should verify if any service or donation roles require removal, or status changed.', config.discord.log_channel);
                }
              });
            } 
            if (!charge_found) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Charge Refund id '+data.object.id+' for '+data.object.customer+' not found in user record. Logging request for review. Replay webhook from your Stripe Dashboard once you deal with it.');
              console.info(data);
              return bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'Charge Refund id '+data.object.id+' for '+data.object.customer+' not found in user record.', 'Logging request for review. Replay webhook from your Stripe Dashboard once you deal with it.', config.discord.log_channel);
            }
            else {
              if (data.object.calculated_statement_descriptor == config.stripe.service_product_descriptor) {
                if (config.stripe.taxes.active) {
                  if (dbuser.tax_rate === 0 || !dbuser.tax_rate) { return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has no tax rate but taxes enabled. Replay the webhook from your Stripe Dashboard after you deal with that.'); }
                  fee_amount = Math.round(data.object.amount_refunded / (dbuser.tax_rate + 1));
                  tax_amount = (data.object.amount_refunded - fee_amount) / 100;
                  fee_amount = fee_amount / 100;
                }
                else {
                  fee_amount = data.object.amount_refunded / 100;
                  tax_amount = 0;
                }
                type_text = '⚠️ Services Payment to '+config.server.site_name+' Refunded! 💰';
              }
              else if (data.object.calculated_statement_descriptor == config.stripe.donation_product_descriptor) {
                fee_amount = data.object.amount_refunded / 100;
                tax_amount = 0;
                type_text = '⚠️ Donation Payment to '+config.server.site_name+' Refunded! 💰';
                dbuser.donation_data.total = dbuser.donation_data.total - fee_amount;
                if (data.object.amount_refunded === data.object.amount) {
                  dbuser.donation_data.counter = dbuser.donation_data.counter - 1;
                }
              }
              tax_info = '**(Fee: $'+parseFloat(fee_amount).toFixed(2)+', Tax: $'+parseFloat(tax_amount).toFixed(2)+')**';
              if (member) { bot.sendDM(member, type_text, 'Amount: **$'+parseFloat(data.object.amount / 100).toFixed(2)+'** '+tax_info, 'FFFF00'); }
              bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FFFF00', type_text, 'Amount: **$'+parseFloat(data.object.amount / 100).toFixed(2)+'** '+tax_info, config.discord.log_channel);
              total_spend = dbuser.total_spend - fee_amount;
              if (config.service_zones.votes_enabled) {
                total_votes = Math.floor(total_spend / config.service_zones.vote_worth) + 1;
              }
              else {
                total_votes = dbuser.total_votes;
              }
              if (config.qbo.enabled) {
                // create refund receipt to stripe holding
                // maybe compare total spend to qbo if easy enough
              }
            }
            if (dbuser.donation_data) {
              dbuser.donation_data = JSON.stringify(dbuser.donation_data);
            }
            await database.runQuery(`UPDATE customers SET stripe_data = ?, donation_data = ?, charge_list = ?, total_spend = ?, total_votes = ? WHERE user_id = ?`, [JSON.stringify(customer), dbuser.donation_data, JSON.stringify(charge_list), total_spend, total_votes, dbuser.user_id]);
            if (dbuser.total_votes > total_votes) {
              if (dbuser.format === 1) {
                for (let a = 0; a < dbuser.allocations.length; a++) {
                  percentage = percentage + dbuser.allocations[a].percent;
                }
                await database.allocateVotes(dbuser.user_id, dbuser.allocations, percentage);
              }
              else {
                highestVote = 0;
                lowestVote = 999999;
                highestZoneIndex = -1;
                lowestVoteIndex = -1;
                vote_counter = 0;
                for (let i = 0 ; i < dbuser.zone_votes.length ; i++) {
                  vote_counter = vote_counter + dbuser.zone_votes[i].votes;
                  if (dbuser.zone_votes[i].votes > highestVote) {
                    highestVote = dbuser.zone_votes[i].votes;
                    highestZoneIndex = i;
                  }
                  if (dbuser.zone_votes[i].votes != 0 && dbuser.zone_votes[i].votes < lowestVote) {
                    lowestVote = dbuser.zone_votes[i].votes;
                    lowestVoteIndex = i;
                  }
                }
                if (vote_counter > total_votes) {
                  if (highestZoneIndex > -1) {
                    if (highestZoneIndex > 0) {
                      dbuser.zone_votes[highestZoneIndex].votes = dbuser.zone_votes[highestZoneIndex].votes - (dbuser.total_votes-total_votes);
                    }
                    else {
                      dbuser.zone_votes[lowestVoteIndex].votes = dbuser.zone_votes[lowestVoteIndex].votes - (dbuser.total_votes-total_votes);
                    }
                  }
                  await database.runQuery(`UPDATE customers SET zone_votes = ? WHERE user_id = ?`, [JSON.stringify(dbuser.zone_votes), dbuser.user_id]);
                }
              }
              if (member) { bot.sendDM(member, 'Votes Removed and/or Reallocated ⚠️', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to check amounts.', 'FFFF00'); }
              bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FFFF00', 'Votes Removed and/or Reallocated ⚠️', 'Old Total: '+dbuser.total_votes+', New Total: '+total_votes+'. [Log in here]('+config.discord.redirect_url+') to run worker calc.', config.discord.log_channel);
            }
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION DELETED
//------------------------------------------------------------------------------
      case 'customer.subscription.deleted':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Deleted Subcscription webhook for '+data.object.customer);
        customer = await stripe.customer.fetch(data.object.customer);
        dbuser = await database.fetchUser(customer.description);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        switch(true){
          case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild');
          default:
            cx_type = dbuser.customer_type;
            for (let i = 0; i < config.stripe.price_ids.length; i++) {
              if (data.object.items.data[0].price.id == config.stripe.price_ids[i].id) {
                bot.sendDM(member, 'Subscription Record Deleted! ⚰', 'If you did not cancel, your payment has failed. Please log in and select a new plan if you wish to continue.', 'FF0000');
                bot.removeRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', 'Subscription Record Deleted! ⚰', '', config.discord.log_channel);
                if (dbuser.customer_type == 'subscriber') {
                  cx_type = 'inactive';
                  if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
                }
                return database.runQuery(`UPDATE customers SET customer_type = ?, stripe_data = ?, WHERE user_id = ?`, [cx_type, JSON.stringify(customer), dbuser.user_id]);
              }
            }
            for (let d = 0; d < config.stripe.donation_ids.length; d++) {
              if (checkout.line_items.data[0].price.id == config.stripe.donation_ids[d].id) {
                bot.sendDM(member, 'Donation Subscription Deleted! ⚰', 'Thank you again for your generosity! If you did not cancel, your payment has failed. Please log in and select a new plan if you wish to continue.', 'FF0000');
                bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', 'Donation Subscription Deleted! ⚰', '', config.discord.log_channel);
                if (dbuser.donation_data.role_ids[0] != "" && dbuser.donation_data.role_ids[0] != dbuser.donation_data.role_ids[1]) {
                  bot.removeRole(config.discord.guild_id, dbuser.user_id, dbuser.donation_data.role_ids[0], dbuser.user_name);
                  dbuser.donation_data.role_ids[0] = "";
                }
                return database.runQuery(`UPDATE customers SET stripe_data = ?, donation_data = ? WHERE user_id = ?`, [JSON.stringify(customer), JSON.stringify(dbuser.donation_data), dbuser.user_id]);
              }
            }
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION UPDATED
//------------------------------------------------------------------------------
      case 'customer.subscription.updated':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Updated Subcscription webhook for '+data.object.customer);
        customer = await stripe.customer.fetch(data.object.customer);
        dbuser = await database.fetchUser(customer.description);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        switch (true) {
          case !dbuser: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild');
          case (data.object.status == "active" && data.previous_attributes.status == "incomplete"):
            return console.info('['+bot.getTime('stamp')+'] [stripe.js] Provisioning handled by Checkout, Skipping');
          case (!data.previous_attributes.cancel_at_period_end && data.object.cancel_at_period_end):
            database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(customer), dbuser.user_id]);
            let cancel = new Date(data.object.cancel_at * 1000).toLocaleString(config.server.tz_locale, { timeZone: config.server.time_zone });
            bot.sendEmbed(dbuser.user_name, dbuser.user_id, 'FF0000', 'Subscription Pending Cancellation. ⚰', 'Canceles at: '+cancel+', '+config.server.tz_text+'.', config.discord.log_channel);
            return bot.sendDM(member, 'Subscription Pending Cancellation. ⚰', 'Canceles at: '+cancel+'.\nIf you change your mind, simply log back in and resume!', 'FF0000');
          case (data.previous_attributes.cancel_at_period_end && !data.object.cancel_at_period_end):
            database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(customer), dbuser.user_id]);
            bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'Subscription Resumed! ✅', '', config.discord.log_channel);
            return bot.sendDM(member, 'Subscription Resumed! ✅', 'Thank you for continuing! Your business is appreciated!', '00FF00');
          default:
            if (data.object.status == "active" && data.previous_attributes.items) {
              for (let i = 0; i < config.stripe.price_ids.length; i++) {
                if (data.object.items.data[0].price.id == config.stripe.price_ids[i].id) {
                  bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name, dbuser.access_token);
                  bot.sendDM(member, 'Subscription Sucessfully Updated! ✅', 'Thank you for your continuing business!', '00FF00');
                  bot.sendEmbed(dbuser.user_name, dbuser.user_id, '00FF00', 'Subscription Sucessfully Updated! ✅', '', config.discord.log_channel);
                  database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(customer), dbuser.user_id]);
                  for (let x = 0; x < config.stripe.price_ids.length; x++) {
                    if (data.previous_attributes.items.data[0].price.id == config.stripe.price_ids[x].id) {
                      bot.removeRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[x].role_id, dbuser.user_name);
                    }
                  }
                }
              }
              return;
            }
            else {
              database.runQuery(`UPDATE customers SET stripe_data = ? WHERE user_id = ?`, [JSON.stringify(customer), dbuser.user_id]);
              return console.info('['+bot.getTime('stamp')+'] [stripe.js] Webhook for '+data.object.customer+' likely requires no action, saved customer object and logging.\n', data);
            }
        } return;
    } return;
  }
};

// EXPORT OBJECT
module.exports = stripe;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
database = require(__dirname+'/database.js');
maintenance = require(__dirname+'/maintenance.js');
oauth2 = require(__dirname+'/oauth2.js');
qbo = require(__dirname+'/qbo.js');
qboData = require(__dirname+'/qboData.js');