var database, bot, oauth2;
const axios = require('axios');
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
    create: function(user_name, user_id, user_email) {
      return new Promise(function(resolve) {
        stripe_js.customers.create({
          name: user_name,
          description: user_id,
          email: user_email
        }, function(err, customer) {
          if(err) {
            console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Creating Customer.', err.message);
            return resolve('ERROR');
          } else {
            console.info('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.name+' ('+customer.description+' | '+customer.id+') has been Created.');
            database.runQuery('UPDATE stripe_users SET stripe_id = ? WHERE user_id = ?', [customer.id, user_id]);
            return resolve(customer);
          }
        });
      });
    },
//------------------------------------------------------------------------------
//  UPDATE A CUSTOMER
//------------------------------------------------------------------------------
    update: function(customer_id, email, name) {
      return new Promise(function(resolve) {
        stripe_js.customers.update(
          customer_id,
          { email: email, name: name },
          function(err, customer) {
            if(err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Updating Customer.', err.message);
              return resolve('ERROR');
            } else {
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
            if(err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Fetching Customer.', err.message);
              return resolve('ERROR');
            } else {
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
            if(err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Deleting Customer.', err.message);
              return resolve('ERROR');
            } else {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+name+' ('+discord_id+' | '+customer_id+') has been Deleted.');
              return resolve(confirmation);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  MAINTENANCE ROUTINES (STRIPE)
//------------------------------------------------------------------------------
    list: async function() {
      console.info("["+bot.getTime("stamp")+"] [stripe.js] Starting Stripe Customer Sync.");
      let list = [];
      for await (const customer of stripe_js.customers.list({ limit: 100, expand: ['data.subscriptions'] })) {
        list.push(customer);
      } return stripe.customer.parse(list);
    },
    parse: async function(parse) { 
      console.info("["+bot.getTime('stamp')+"] [stripe.js] Parsing "+parse.length+" users.")
      let unix = moment().unix();
      parse.forEach((customer,index) => {
        let indexcounter = index + 1;
        setTimeout(async function() {
          record = await database.db.query('SELECT * FROM stripe_users WHERE user_id = ?', [customer.description]);
            let stripe_updated = false;
            let db_updated = false;
            if (!record[0]) { return console.info('['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+')', err.message); }
            if (record[0].length = 0) {
              try {
                database.runQuery('INSERT INTO stripe_users (user_name, user_id, stripe_id, email) VALUES (?, ?, ?, ?)', [customer.name, customer.description, customer.id, customer.email]);
                console.info('['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+') Inserted User into Database. This user may require Manual Temp Plan updating');
                bot.sendEmbed(customer.name, customer.description, "FF0000", "Stripe.JS Maintenance Log", "Inserted User into Database. This user may require Manual Data updating", config.discord.log_channel);
                let data = {};
                data.user_name = customer.name;
                data.user_id = customer.description;
                data.email = customer.email;
                data.stripe_id = customer.id;
                record[0].splice(0, 0, data);
              } catch (e) {
                console.info('['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+') Unable to insert User into Database, ', e);
                bot.sendEmbed(customer.name, customer.description, "FF0000", "Stripe.JS Maintenance Log", "Unable to insert User into Database, "+e, config.discord.log_channel);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
              }
            }
            if (!record[0].charges) {
              let hasHistory = [];
              for await (const charges of stripe_js.charges.list({ customer: customer.id, limit: 100 })) {
                hasHistory.push(charges);
              }
              if (hasHistory[0]) {
                database.runQuery('UPDATE stripe_users SET charges = ? WHERE user_id = ?', [hasHistory.length, customer.description]);
                db_updated = true;
              }
            }
            if (customer.name != record[0].user_name || customer.email != record[0].email) {
              stripe.customer.update(customer.id, record[0].email, record[0].user_name);
              stripe_updated = true;
            }
            if (customer.id != record[0].stripe_id) {
              database.runQuery('UPDATE stripe_users SET stripe_id = ? WHERE user_id = ?', [customer.id, customer.description]);
              db_updated = true;
            } //check and fix ID
            if (customer.subscriptions.data.length > 0) {
              for (let x = 0; x < customer.subscriptions.data.length; x++) {
                for (let i = 0; i < config.stripe.price_ids.length; i++) {
                  if (customer.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
                    if (customer.subscriptions.data[x].items.data[0].price.id != record[0].price_id && customer.subscriptions.data[x].status == 'active') {
                      database.runQuery('UPDATE stripe_users SET customer_type = ?, price_id = ?, expiration = ? WHERE user_id = ?', ['subscriber', customer.subscriptions.data[x].items.data[0].price.id, customer.subscriptions.data[x].current_period_end, customer.description]);
                      if (record[0].customer_type == 'inactive' || record[0].customer_type == 'lifetime-inactive') { 
                        await database.updateActiveVotes(customer.description, 1);
                        await database.updateZoneRoles(customer.description);
                      }
                      db_updated = true;
                    }
                  } // dead end of customer price vs config price
                } // dead end for every price in config
              } // dead end for each sub in customer array (usually 1)
            }
            if (record[0].price_id && record[0].expiration) {
              for (let i = 0; i < config.stripe.price_ids.length; i++) {
                if (record[0].price_id == config.stripe.price_ids[i].id) {
                  if (config.stripe.price_ids[i].mode == "subscription" || record[0].expiration < unix) {
                    database.runQuery('UPDATE stripe_users SET customer_type = ?, price_id = NULL, expiration = NULL WHERE user_id = ?', ['inactive', customer.description]);
                    if (record[0].customer_type == 'subscriber' || record[0].customer_type == 'pay-as-you-go' || record[0].customer_type == 'manual' || record[0].customer_type == 'lifetime-active') { 
                      await database.updateActiveVotes(customer.description, 0); 
                      await database.updateZoneRoles(customer.description, null, 'all','remove');
                    }
                    db_updated = true;
                  /*} else {*/
                    /* Maybe something about storing, pulling & checking invoice details & expiry calc for temp plans , but probably too much and not needed */
                  } //end if mode is sub or temp plan expired
                } // end if record price matches config price
              } // dead end for each price in config
            } // end if db price not null
            let log_start = '['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+')';
            let log_db_up = ' Updated Stripe IDs';
            let log_db_ver = ' Verified Stripe IDs';
            let log_str_up = ' Updated Stripe Info';
            let log_str_ver = ' Verified Stripe Info';
            switch(true){
              case (stripe_updated && db_updated):
                console.info(log_start+log_db_up+' &'+log_str_up);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                break;
              case (stripe_updated && !db_updated):
                console.info(log_start+log_db_ver+' &'+log_str_up);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                break;
              case (db_updated && !stripe_updated):
                console.info(log_start+log_db_up+' &'+log_str_ver);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                break;
              default:
                console.info(log_start+log_db_ver+' &'+log_str_ver);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
            } // end if updated or verified
        }, 1000 * index);
      }); //end for each customer
    },
    doneParse: async function() {
      console.info("["+bot.getTime("stamp")+"] [stripe.js] Stripe Customer Sync Complete, proceeding to Database checks.");
      return database.checkDatabaseRoles();
    }
  },
//------------------------------------------------------------------------------
//  STRIPE SUBSCRIPTION FUNCTIONS
//------------------------------------------------------------------------------
  subscription: {
//------------------------------------------------------------------------------
//  CANCEL A SUSBCRIPTION
//------------------------------------------------------------------------------
    cancel: async function(username, user_id, subscription_id){
        stripe_js.subscriptions.del(
          subscription_id,
          function(err, confirmation) {
            if(err){
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Canceling Subscription.', err.message);
              return null;
            } else{
              bot.sendEmbed(username, user_id, 'FF0000', 'Subscription Cancellation', '', config.discord.log_channel);
              console.info("["+bot.getTime("stamp")+"] [stripe.js] "+username+"'s subscription has been cancelled due to leaving the Server.");
              return confirmation;
            }
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
      var values = req.body.checkout.split(":");
      const customerID = values[0];
      const priceID = values[1];
      const mode = values[2];
      var sessionbody = {
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
          sessionbody.automatic_tax = {enabled: true};
        } else if (config.stripe.taxes.dynamic) {
          sessionbody.line_items[0].dynamic_tax_rates = config.stripe.taxes.rate_ids;
        } else {
          sessionbody.line_items[0].tax_rates = config.stripe.taxes.rate_ids;
        }
      }
      if (config.stripe.addresses.billing) {
        sessionbody.billing_address_collection = "required";
        sessionbody.customer_update = {address: "auto"};
      }
      if (config.stripe.addresses.shipping) {
        sessionbody.shipping_address_collection = {allowed_countries: config.stripe.addresses.shipping};
        if (sessionbody.customer_update.address) {
          sessionbody.customer_update.shipping = "auto";
        } else {
          sessionbody.customer_update = {shipping: "auto"};
        }
      }
      try {
        const session = await stripe_js.checkout.sessions.create(sessionbody);
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
        const customerID = req.body.customerID;
        const session = await stripe_js.billingPortal.sessions.create({
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
            if(err) {
              console.info('['+bot.getTime('stamp')+'] [stripe.js] Error Fetching Checkout.', err.message);
              return resolve('ERROR');
            } else {
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
    } else {
      data = req.body.data;
      eventType = req.body.type;
    }
    res.sendStatus(200);
    return stripe.webhookParse(data, eventType);
  },
  webhookParse: async function(data, eventType) {
    let customer = '', user = '', member = '', checkout = '', tax_info = ' ', gt_amount, st_amount, tax_amount, tax_rate, expiry;
    switch(eventType){
//------------------------------------------------------------------------------
//   CUSTOMER CREATED
//------------------------------------------------------------------------------
      case 'customer.created':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Customer Created Webhook received for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        user = await database.fetchStripeUser(data.object.description, data.object.id);
        if (user.expiration && user.expiration > 9999999997) {
          return bot.sendEmbed(user.user_name, user.user_id, '00FF00', '📋 New Stripe Customer Created! 💰', 'Lifetime Member has logged in for the first time!', config.discord.log_channel);
        } else if (user.customer_type == 'manual') {
          return bot.sendEmbed(user.user_name, user.user_id, '00FF00', '📋 New Stripe Customer Created! 💰', 'Manual Tracked User has logged in for the first time!', config.discord.log_channel);
        } else {
          return bot.sendEmbed(user.user_name, user.user_id, '00FF00', '📋 New Stripe Customer Created! 💰', 'Prospect User has logged in!', config.discord.log_channel);
        }
//------------------------------------------------------------------------------
//   CUSTOMER UPDATED
//------------------------------------------------------------------------------
      case 'customer.updated':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Customer Updated Webhook received for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        user = await database.fetchStripeUser(data.object.description, data.object.id);
        switch(true){
          case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
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
              database.runQuery('UPDATE stripe_users SET tax_rate = ? WHERE user_id = ?', [tax_rate, user.user_id]);
              return bot.sendEmbed(user.user_name, user.user_id, 'FF0000', '📋 Stripe Customer Changed Tax Jurisdiction.', 'Updated Tax information.', config.discord.log_channel);
            } else {
              return console.info('['+bot.getTime('stamp')+'] [stripe.js] Tax jurisdiction same, nothing to change');
            }
        }
//------------------------------------------------------------------------------
//   CUSTOMER DELETED
//------------------------------------------------------------------------------
      case 'customer.deleted':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Customer Deleted Webhook received for '+data.object.name+' ('+data.object.email+', '+data.object.description+', '+data.object.id+')');
        user = await database.fetchStripeUser(data.object.description, data.object.id);
        switch(true){
          case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          default:
            let query = ''
            let data = [];
            if (user.customer_type == 'subscriber' || user.customer_type == 'pay-as-you-go') {
              await database.updateActiveVotes(customer.description, 0);
              await database.updateZoneRoles(customer.description, null, 'all','remove');              
              query = 'UPDATE stripe_users SET customer_type = ?, stripe_id = NULL, price_id = NULL, tax_rate = NULL, charge_id = NULL WHERE user_id = ?'
              data = ['inactive', user.user_id];
            } else { 
              query = 'UPDATE stripe_users SET stripe_id = NULL, price_id = NULL, tax_rate = NULL, charge_id = NULL WHERE user_id = ?'
              data = [user.user_id];
            }
            database.runQuery(query, data);
            return bot.sendEmbed(user.user_name, user.user_id, 'FF0000', '📋 Stripe Customer Deleted.', 'Deleted Stripe information.', config.discord.log_channel);
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
        user = await database.fetchStripeUser(customer.description, customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        checkout = await stripe.sessions.fetchCheckout(data.object.id);
        gt_amount = data.object.amount_total/100;
        st_amount = data.object.amount_subtotal/100;
        total_spend = user.total_spend+st_amount;
        if (config.service_zones) {
          total_votes = parseFloat(total_spend/config.service_zones.vote_worth).toFixed(0)+1;
          if (user.total_votes < total_votes) {}
        }
        if (config.stripe.taxes.active) {
          if (data.object.total_details.amount_tax > 0) {
            tax_amount = parseFloat(data.object.total_details.amount_tax/100).toFixed(2);
            tax_rate = parseFloat(data.object.total_details.amount_tax/data.object.amount_subtotal).toFixed(2);
          } else {
            tax_amount = 0;
            tax_rate = 0;
          }
          tax_info = '**(Fee: $'+st_amount+', Tax: $'+tax_amount+')**';
        }
        switch(true){
          case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild during Checkout');
          default:
            for (let i = 0; i < config.stripe.price_ids.length; i++) {
              if (checkout.line_items.data[0].price.id == config.stripe.price_ids[i].id) {
                bot.assignRole(config.discord.guild_id, user.user_id, config.stripe.price_ids[i].role_id, customer.name, user.access_token);
                bot.channels.cache.get(config.discord.welcome_channel)
                  .send(config.discord.welcome_content.replace('%usertag%','<@'+member.user.id+'>'))
                  .catch(console.info);
                let charge_id;
                if (!checkout.payment_intent) {
                  for (let x = 0; x < customer.subscriptions.data.length; x++) {
                    if (customer.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
                      charge_id = customer.subscriptions.data[x].latest_invoice.charge;
                      expiry = customer.subscriptions.data[x].current_period_end;
                    }
                  }
                } else { 
                  charge_id = checkout.payment_intent.latest_charge.id;
                  if (!user.expiration || user.expiration && user.expiration > 9999999997 || user.expiration && user.expiration < checkout.payment_intent.latest_charge.created) {
                    expiry = checkout.payment_intent.latest_charge.created + config.stripe.price_ids[i].expiry;
                  } else {
                    expiry = user.expiration + config.stripe.price_ids[i].expiry;
                  }
                }
                let chargecounter = 0;
                if (user.charges) { chargecounter = user.charges; }
                chargecounter++;
                let cx_type, type_text;
                if (user.customer_type == 'inactive' || user.customer_type == 'lifetime-inactive') { 
                  await database.updateActiveVotes(customer.description, 1);
                  await database.updateZoneRoles(customer.description);
                }
                if (data.object.mode == 'subscription') {
                  cx_type = 'subscriber';
                  type_text = '✅ Subscription Creation Payment to';
                } else if (data.object.mode == 'payment') {
                  cx_type = 'pay-as-you-go';
                  type_text = '✅ Pay-As-You-Go Access Payment to';
                }
                bot.sendDM(member, type_text+' '+config.server.site_name+' Successful! 💰', 'Amount: **$'+gt_amount+'** '+tax_info,'00FF00');
                bot.sendEmbed(user.user_name, user.user_id, '00FF00', type_text+' '+config.server.site_name+' Successful! 💰', 'Amount: **$'+gt_amount+'** '+tax_info, config.discord.log_channel);
                return database.runQuery('UPDATE stripe_users SET customer_type = ?, price_id = ?, expiration = ?, total_spend = ?, tax_rate = ?, charge_id = ?, charges = ? WHERE user_id = ?', [cx_type, checkout.line_items.data[0].price.id, expiry, total_spend, tax_rate, charge_id, chargecounter, member.user.id]);
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
          user = await database.fetchStripeUser(customer.description, customer.id);
          member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
          switch(true){
            case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
            case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild');
            case (!user.price_id || user.charge_id && data.object.id == user.charge_id): return console.info('['+bot.getTime('stamp')+'] [stripe.js] Initial charge handled by checkout webhook.');
            default:
              let chargecounter = 0;
              if (user.charges) { chargecounter = user.charges; }
              chargecounter++;
              if (data.object.calculated_statement_descriptor == config.stripe.calculated_statement_descriptor) {
                if (config.stripe.taxes.active && user.tax_rate) {
                  let fee_amount = parseFloat(data.object.amount/(user.tax_rate+1));
                  let tax_amount = parseFloat(data.object.amount-(fee_amount));
                  tax_info = '**(Fee: $'+parseFloat(fee_amount/100).toFixed(2)+', Tax: $'+parseFloat(tax_amount/100).toFixed(2)+')**';
                } else if (config.stripe.taxes.active) {
                  tax_info = '**(Applicable Fees and Taxes Included)**';
                }
                database.runQuery('UPDATE stripe_users SET charge_id = ?, charges = ? WHERE user_id = ?', [data.object.id, chargecounter, user.user_id]);
                bot.sendDM(member,'✅ Payment to '+config.server.site_name+' Successful! 💰', 'Amount: **$'+parseFloat(data.object.amount/100).toFixed(2)+'** '+tax_info,'00FF00');
                return bot.sendEmbed(user.user_name, user.user_id, '00FF00', '✅ Payment to '+config.server.site_name+' Successful! 💰', 'Amount: **$'+parseFloat(data.object.amount/100).toFixed(2)+'** '+tax_info, config.discord.log_channel);
              } else {
                database.runQuery('UPDATE stripe_users SET charges = ? WHERE user_id = ?', [chargecounter, user.user_id]);
                bot.sendDM(member, config.stripe.alt_charge_text, 'Amount: **$'+parseFloat(data.object.amount/100).toFixed(2)+'**','00FF00');
                return bot.sendEmbed(user.user_name, user.user_id, '00FF00', config.stripe.alt_charge_text, 'Amount: **$'+parseFloat(data.object.amount/100).toFixed(2)+'**', config.discord.log_channel);
              }
          }
        }, 5000); return;
//------------------------------------------------------------------------------
//   CHARGE REFUNDED
//------------------------------------------------------------------------------
      case 'charge.refunded':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Charge Refund webhook for '+data.object.customer);
        customer = await stripe.customer.fetch(data.object.customer);
        user = await database.fetchStripeUser(customer.description, customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        switch(true){
          case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild');
          case (config.stripe.rem_role_full_refund && user.charge_id && data.object.id == user.charge_id && data.amount_captured === data.object.amount_refunded):
          case (config.stripe.rem_role_any_refund && user.charge_id && data.object.id == user.charge_id):
            for (let i = 0; i < config.stripe.price_ids.length; i++) {
              if (user.price_id == config.stripe.price_ids[i].id) {
                bot.removeRole(config.discord.guild_id, customer.description, config.stripe.price_ids[i].role_id, customer.name);
                database.runQuery('UPDATE stripe_users SET price_id = NULL, expiration = NULL, charge_id = NULL WHERE user_id = ?', [user.user_id]);
              }
            }
          default:
            if (data.object.calculated_statement_descriptor == config.stripe.calculated_statement_descriptor) {
              if (config.stripe.taxes.active && user.tax_rate) {
                let fee_amount = parseFloat(data.object.amount_refunded/(user.tax_rate+1));
                let tax_amount = parseFloat(data.object.amount-(fee_amount));
                tax_info = '**(Fee: $'+parseFloat(fee_amount/100).toFixed(2)+', Tax: $'+parseFloat(tax_amount/100).toFixed(2)+')**';
              } else if (config.stripe.taxes.active) {
                tax_info = '**(Applicable Fees and Taxes Included)**';
              }
              bot.sendDM(member,'Payment for '+config.server.site_name+' Refunded. 🏧', 'Amount: **$'+data.object.amount_refunded/100+'** '+tax_info,'0000FF');
              return bot.sendEmbed(user.user_name, user.user_id, '0000FF', 'Payment for '+config.server.site_name+' Refunded. 🏧', 'Amount: **$'+data.object.amount_refunded/100+'** '+tax_info, config.discord.log_channel);
            } else {
              bot.sendDM(member, config.stripe.alt_refund_text, 'Amount: **$'+parseFloat(data.object.amount/100).toFixed(2)+'**','00FF00');
              return bot.sendEmbed(user.user_name, user.user_id, '00FF00', config.stripe.alt_refund_text, 'Amount: **$'+parseFloat(data.object.amount/100).toFixed(2)+'**', config.discord.log_channel);
            }
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION DELETED
//------------------------------------------------------------------------------
      case 'customer.subscription.deleted':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Deleted Subcscription webhook for '+data.object.customer);
        customer = await stripe.customer.fetch(data.object.customer);
        user = await database.fetchStripeUser(customer.description, customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        switch(true){
          case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild');
          default:
            for (let i = 0; i < config.stripe.price_ids.length; i++) {
              if (data.object.items.data[0].price.id == config.stripe.price_ids[i].id) {
                bot.sendDM(member,'Subscription Record Deleted! ⚰', 'If you did not cancel, your payment has failed. Please log in and select a new plan','FF0000');
                bot.removeRole(config.discord.guild_id, customer.description, config.stripe.price_ids[i].role_id, customer.name);
                bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Subscription Record Deleted! ⚰', '', config.discord.log_channel);
                return database.runQuery('UPDATE stripe_users SET price_id = NULL, tax_rate = NULL, charge_id = NULL WHERE user_id = ?', [customer.description]);
              }
            }
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION UPDATED
//------------------------------------------------------------------------------
      case 'customer.subscription.updated':
        console.info('['+bot.getTime('stamp')+'] [stripe.js] Received Updated Subcscription webhook for '+data.object.customer);
        customer = await stripe.customer.fetch(data.object.customer);
        user = await database.fetchStripeUser(customer.description, customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description);
        switch(true){
          case !user: return console.info('['+bot.getTime('stamp')+'] [stripe.js] Database Error, no user returned');
          case !member: return console.info('['+bot.getTime('stamp')+'] [stripe.js] User has left Guild');
          case (data.object.status == "active" && data.previous_attributes.status == "incomplete"):
            return console.info('['+bot.getTime('stamp')+'] [stripe.js] Provisioning handled by Checkout, Skipping');
          case (!data.previous_attributes.cancel_at_period_end && data.object.cancel_at_period_end):
            let cancel = new Date(data.object.cancel_at * 1000).toLocaleString(config.server.tz_locale, { timeZone: config.server.time_zone });
            bot.sendEmbed(user.user_name, user.user_id, 'FF0000', 'Subscription Pending Cancellation. ⚰', 'Canceles at: '+cancel+', '+config.server.tz_text+'.', config.discord.log_channel);
            return bot.sendDM(member,'Subscription Pending Cancellation. ⚰', 'Canceles at: '+cancel+'.\nIf you change your mind, simply log back in and resume!','FF0000');
          case (data.previous_attributes.cancel_at_period_end && !data.object.cancel_at_period_end):
            bot.sendEmbed(user.user_name, user.user_id, '00FF00', 'Subscription Resumed! ✅', '', config.discord.log_channel);
            return bot.sendDM(member,'Subscription Resumed! ✅', 'Thank you for continuing! Your business is appreciated!','00FF00');
          default:
            if (data.object.status == "active" && data.previous_attributes.items) {
              for (let i = 0; i < config.stripe.price_ids.length; i++) {
                if (data.object.items.data[0].price.id == config.stripe.price_ids[i].id) {
                  bot.assignRole(config.discord.guild_id, customer.description, config.stripe.price_ids[i].role_id, customer.name, user.access_token);
                  bot.sendDM(member,'Subscription Sucessfully Updated! ✅', 'Thank you for your continuing business!','00FF00');
                  bot.sendEmbed(user.user_name, user.user_id, '00FF00', 'Subscription Sucessfully Updated! ✅', '', config.discord.log_channel);
                  database.runQuery('UPDATE stripe_users SET price_id = ? WHERE user_id = ?', [data.object.items.data[0].price.id, member.user.id]);
                  for (let x = 0; x < config.stripe.price_ids.length; x++) {
                    if (data.previous_attributes.items.data[0].price.id == config.stripe.price_ids[x].id) {
                      bot.removeRole(config.discord.guild_id, customer.description, config.stripe.price_ids[x].role_id, customer.name);
                    }
                  }
                }
              }
            } else { return console.info('['+bot.getTime('stamp')+'] [stripe.js] Webhook for '+data.object.customer+' likely requires no action, logging.\n', data);
            } return;
          } return;
    } return;
  }
};

// EXPORT OBJECT
module.exports = stripe;

// SCRIPT REQUIREMENTS
bot = require(__dirname+'/bot.js');
oauth2 = require(__dirname+'/oauth2.js');
database = require(__dirname+'/database.js');