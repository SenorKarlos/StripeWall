const ontime = require("ontime");
const moment = require("moment");
const express = require("express");
const discord = require("discord.js");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const bot = require(__dirname + "/modules/bot.js");
const oauth2 = require(__dirname + "/modules/oauth2.js");
const stripe = require(__dirname + "/modules/stripe.js");
const database = require(__dirname + "/modules/database.js");
const config = require(__dirname + "/files/config.json");

//------------------------------------------------------------------------------
//  SERVER CONFIGURATIONS
//------------------------------------------------------------------------------
var sessionAge = 518400000;
const server = express();
server.use(bodyParser.urlencoded({
  extended: true
}));

server.engine("html", require("ejs").renderFile);

server.use(cookieSession({
  name: "session",
  keys: [config.session_key],
  maxAge: sessionAge,
}));
//------------------------------------------------------------------------------
//  LOGIN/OAUTH FLOW
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();
  
  if (!req.query.code) {
  //------------------------------------------------------------------------------
  //  SEND TO DISCORD OAUTH2
  //------------------------------------------------------------------------------
    console.info("[" + bot.getTime("stamp") + "] [wall.js] Login from " + req.headers['x-forwarded-for'] + ". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}`);
  } else {
  //------------------------------------------------------------------------------
  //  REDIRECT FROM OAUTH WITH CODE
  //------------------------------------------------------------------------------
    let data = await oauth2.fetchAccessToken(req.query.code);
    let user = await oauth2.fetchUser(data.access_token);
    if (!user || user == undefined) {
      req.session = null;
      console.info("[" + bot.getTime("stamp") + "] [wall.js] Failed to fetch User");
      return res.redirect(config.map_url);
    }
    //------------------------------------------------------------------------------
    //  CHECK BLACKLIST & GUILD MEMBER STATUS
    //------------------------------------------------------------------------------
    if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
      let member = await bot.guilds.cache.get(config.guild_id).members.cache.get(user.id);
      if (!member || member == undefined) {
        await bot.users.fetch(user.id).then(user => {
          member = {
            user: user
          };
        });
      }
      bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.log_channel);
      return res.redirect(`/blocked`);
    }
    let member = await bot.guilds.cache.get(config.guild_id).members.cache.get(user.id);
    if (!member) {
      await oauth2.joinGuild(data.access_token, config.guild_id, user.id);
      await bot.users.fetch(user.id).then(user => {
        member = {
          user: user
        };
      });
      console.info("[" + bot.getTime("stamp") + "] [wall.js] " + member.user.username + "#" + member.user.discriminator + " not a Guild Member, adding.");
    }
    req.session.discord_id = user.id;
    req.session.email = user.email;
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    req.session.token_expiration = (unix_now + data.expires_in);
    req.session.user_name = member.user.username;

    let user_data = [req.session.discord_id, member.user.username, bot.getTime("short"), req.session.email, data.access_token, data.refresh_token, req.session.token_expiration, unix_now]
    database.runQuery(`INSERT IGNORE INTO stripe_users (user_id, user_name, last_login, email, access_token, refresh_token, token_expiration, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, user_data);
    database.runQuery(`UPDATE IGNORE stripe_users SET access_token = ?, refresh_token = ?, token_expiration = ?, last_updated = ? WHERE user_id = ?`, [data.access_token, data.refresh_token, req.session.token_expiration, unix_now, user.id]);

    let dbuser = await database.fetchUser(req.session.discord_id);
    let dbChecked = false;
    if (req.session.email != dbuser.email || req.session.user_name != dbuser.user_name) {
      database.runQuery(`UPDATE IGNORE stripe_users SET email = ?, user_name = ? WHERE user_id = ?`, [req.session.email, req.session.user_name, dbuser.user_id]);
      console.info("[" + bot.getTime("stamp") + "] [wall.js] Updated DB Info for User " + req.session.user_name +  "," + req.session.email + " Formerly: " + dbuser.user_name + "," + dbuser.email);
      dbChecked = true;
    } else {
      dbChecked = true;
    }
    let stripeChecked = false;
    if (!dbuser.stripe_id) {
      let customer = await stripe.customer.create(req.session.user_name, req.session.discord_id, req.session.email);
      dbuser.stripe_id = customer.id;
      stripeChecked = true;
    }
    let customer = await stripe.customer.fetch(dbuser.stripe_id);
    if (stripeChecked == false && customer && customer != 'ERROR') {
      console.info("[" + bot.getTime("stamp") + "] [wall.js] Found Stripe Info for User " + req.session.user_name);
      if (req.session.discord_id != customer.description) {
        bot.sendDM(member, "Error Logging In", "Please contact administration for further assistance", "FF0000");
        bot.sendEmbed(member, "FF0000", "User ID Discrepancy Found", "User " + dbuser.user_name + "'s Discord ID (" + req.session.discord_id + ") not found on matched Stripe Record (" + customer.id + "," + customer.description + ")", config.log_channel);
        return res.redirect(config.map_url);
      }
      if (req.session.email != customer.email || req.session.user_name != customer.name) {
        await stripe.customer.update(dbuser.stripe_id, req.session.email, req.session.user_name);
      }
      if (customer.subscriptions.total_count > 0) {
        if (customer.subscriptions.data[0].plan.id && !dbuser.plan_id || dbuser.plan_id && customer.subscriptions.data[0].plan.id && dbuser.plan_id != customer.subscriptions.data[0].plan.id) {
          database.runQuery(`UPDATE IGNORE stripe_users SET plan_id = ? WHERE user_id = ?`, [customer.subscriptions.data[0].plan.id, dbuser.user_id]);
          console.info("[" + bot.getTime("stamp") + "] [wall.js] Updated DB Info for User " + req.session.user_name +  "," + req.session.email + "(Invalid Plan Updated)");
          dbuser.plan_id = customer.subscriptions.data[0].plan.id;
        }
      }
      if (dbuser.plan_id) {
        if (customer.subscriptions.total_count == 0) {
          database.runQuery(`UPDATE IGNORE stripe_users SET plan_id = NULL WHERE user_id = ?`, [dbuser.user_id]);
          console.info("[" + bot.getTime("stamp") + "] [wall.js] Updated DB Info for User " + req.session.user_name +  "," + req.session.email + "(Invalid Plan Deleted)");
          dbuser.plan_id = null;
        }
      }
      stripeChecked = true;
    }
    if (dbChecked == false || stripeChecked == false) {
      bot.sendDM(member, "Error Logging In", "Please contact administration for further assistance", "FF0000");
      bot.sendEmbed(member, "FF0000", "Login Flow Error", "User " + req.session.user_name + " DB Pass = " + dbChecked + ", Stripe Pass = " + stripeChecked, config.log_channel);
      return res.redirect(config.map_url);
    } else {
      req.session.login = true;
      req.session.stripe_id = dbuser.stripe_id;
      if (dbuser.plan_id) {
        return res.redirect(`/manage`);
      }
      return res.redirect(`/checkout`);
    }
  }
});
//------------------------------------------------------------------------------
//  PRODUCTS CHECKOUT PAGE
//------------------------------------------------------------------------------
server.get("/checkout", async function(req, res) {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();
  if (!req.session.login) {
    console.info("[" + bot.getTime("stamp") + "] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}`);
  } else {
    let checkoutbody = '';
    for (let i = 0; i < config.stripe.plan_ids.length; i++) {
      let planhtml = '<div><h2>$' + config.stripe.plan_ids[i].price + ' ' + config.stripe.plan_ids[i].frequency + ' Access</h2><form action="/create-checkout-session" method="post"><input type="hidden" name="priceID" value="' + config.stripe.plan_ids[i].id + '" /><input type="hidden" name="mode" value="' + config.stripe.plan_ids[i].mode + '" /><input type="hidden" name="customerID" value="' + req.session.stripe_id + '" /><button type="submit">Continue</button></form></div><br><hr>';
      checkoutbody = checkoutbody+planhtml;
    }
    return res.render(__dirname + "/html/checkout.html", {
      checkoutbody: checkoutbody,
      mode: config.stripe.plan_ids[0].mode,
      price_id: config.stripe.plan_ids[0].id,
      customer_id: req.session.stripe_id,
      map_name: config.map_name,
      frequency: config.stripe.plan_ids[0].frequency,
      map_url: config.map_url,
      user_name: req.session.user_name,
      email: req.session.email,
      price: config.stripe.plan_ids[0].price
    });
  }
});
//------------------------------------------------------------------------------
//  STRIPE CHECKOUT
//------------------------------------------------------------------------------
server.post("/create-checkout-session", async (req, res) => {
console.log(req.body);
  const priceID = req.body.priceID;
  const mode = req.body.mode;
  const customerID = req.body.customerID;
  return res.redirect(config.map_url);
/*  try {
    const session = await stripe.checkout.sessions.create({
      mode: mode,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: config.map_url,
      cancel_url: config.map_url,
    });

    return res.redirect(303, session.url);
  } catch (e) {
    res.status(400);
    return res.send({
      error: {
        message: e.message,
      }
    });
  }*/
});
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER PORTAL PAGE
//------------------------------------------------------------------------------
server.post("/manage", async function(req, res) {
return res.redirect(config.map_url);
});
//------------------------------------------------------------------------------
//  PAYMENT CAPTURE SUCCESS
//------------------------------------------------------------------------------
server.post("/success", async function(req, res) {
  let customer = "",
    subscription = "";
  let user = await database.fetchUser(req.session.discord_id);
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
  if (user.stripe_id) {
    customer = await stripe.customer.fetch(user.stripe_id);
  }
  if (!customer || customer.deleted == true) {
    customer = await stripe.customer.create(user.user_name, user.user_id, user.email, req.body.stripeToken);
    if (customer == "ERROR") {
      bot.sendDM(member, "Payment Failed", "Your Subscription payment unfortunately failed. Please check your card account or try a different card.", "FF0000");
      return res.redirect("/checkout");
    }
  }
  if (!customer.subscriptions.data[0]) {
    subscription = await stripe.subscription.create(customer, user.user_id);
  } else {
    subscription = await stripe.customer.update(user.user_id, customer, req.body.stripeToken);
  }
  if (subscription == "ERROR") {
    bot.sendDM(member, "Payment Failed", "Your Subscription payment unfortunately failed. Please check your card account or try a different card.", "FF0000");
    return res.redirect("/checkout");
  } else if (subscription == "INCOMPLETE") {
    bot.sendDM(member, "Payment Failed", "Your Subscription payment unfortunately failed, but a customer record was created. Use the Update button after checking your card account or try a different card.", "FF0000");
    return res.redirect("/checkout");
  } else {
    setTimeout(function() {
      return res.redirect(config.map_url);
    }, 5000);
  }
});
//------------------------------------------------------------------------------
//  SRIPE WEBHOOKS
//------------------------------------------------------------------------------
server.post("/webhook", bodyParser.raw({
  type: "application/json"
}), (webhook, res) => {
  res.sendStatus(200);
  return stripe.webhookParse(JSON.parse(webhook.body));
});
//------------------------------------------------------------------------------
//  BLOCKED PAGE
//------------------------------------------------------------------------------
server.get("/blocked", async function(req, res) {
  return res.render(__dirname + "/html/blocked.html");
}); /*
//------------------------------------------------------------------------------
//  SYNC DISCORD ROLES AND STRIPE SUSBCRIBERS
//------------------------------------------------------------------------------
let times = ["05:30:00", "11:30:00", "17:30:00", "00:30:00"];
ontime({
  cycle: times
}, function(ot) {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Starting Stripe Database Maintenance.");
  database.checkDonors();
  ot.done();
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Stripe Database Maintenance Complete.");
  return;
});
//------------------------------------------------------------------------------
//  SYNC STRIPE CUSTOMER IDs
//------------------------------------------------------------------------------
ontime({
  cycle: ["05:05:00", "11:05:00", "17:05:00", "00:20:00"]
}, function(ot) {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Starting Stripe Customer Synchronization.");
  stripe.customer.list();
  ot.done();
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Stripe Customer Synchronization Complete.");
  return;
}); */
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.listening_port, () => {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Now Listening on port " + config.listening_port + ".");
});