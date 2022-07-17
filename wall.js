const ontime = require("ontime");
const moment = require("moment");
const express = require("express");
const discord = require("discord.js");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const bot = require(__dirname+"/modules/bot.js");
const oauth2 = require(__dirname+"/modules/oauth2.js");
const stripe = require(__dirname+"/modules/stripe.js");
const database = require(__dirname+"/modules/database.js");
const config = require(__dirname+"/files/config.json");
const stripe_js = require('stripe')(config.stripe.live_sk);

//------------------------------------------------------------------------------
//  SERVER CONFIGURATIONS
//------------------------------------------------------------------------------
var sessionAge = 518400000;
const server = express();
server.engine("html", require("ejs").renderFile);
server.use(cookieSession({
  name: "session",
  keys: [config.session_key],
  maxAge: sessionAge,
}));
server.use(bodyParser.urlencoded({
  extended: true
}));
server.use(
  express.json({
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);
//------------------------------------------------------------------------------
//  LOGIN/OAUTH FLOW
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix = moment().unix();
  if (!req.query.code) {
  //------------------------------------------------------------------------------
  //  SEND TO DISCORD OAUTH2
  //------------------------------------------------------------------------------
    console.info("["+bot.getTime("stamp")+"] [wall.js] Login from "+req.headers['x-forwarded-for']+". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
  //------------------------------------------------------------------------------
  //  REDIRECT FROM OAUTH WITH CODE
  //------------------------------------------------------------------------------
    try {
      data = await oauth2.fetchAccessToken(req.query.code);
      if (data.response) {
        throw data.response;
      }
    } catch (e) {
      req.session = null;
      console.log("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Tokens", e);
      return res.redirect(`/error`);
    }
    try {
      user = await oauth2.fetchUser(data.access_token);
      if (user.response) {
        throw user.response;
      }
    } catch (e) {      
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch User from Oauth2", e);
      return res.redirect(`/error`);
    }
    if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
      try {
        await bot.users.fetch(user.id).then(user => {
          member = {
            user: user
          };
        });
        console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Login Attempt.");
        bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.discord.log_channel);
        return res.redirect(`/blocked`);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Login Attempt - Failed to fetch Discord User for blocklist logging", e);
        return res.redirect(`/blocked`);
      }
    } else {
      console.log("["+bot.getTime("stamp")+"] [wall.js] User Passed Blacklist");
    }
    try {
      member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.id);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Guild Member Fecth Failure", e);
      return res.redirect(`/error`)
    }
    if (!member) {
      try {
        console.info("["+bot.getTime("stamp")+"] [wall.js] "+user.username+" not a Guild Member, adding.");
        await oauth2.joinGuild(data.access_token, config.discord.guild_id, user.id);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to join User to Guild", e);
        return res.redirect(`/error`);
      }
      try {
        await bot.users.fetch(user.id).then(user => {
          member = {
            user: user
          };
        });
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Discord User (after Join Guild)", e);
        return res.redirect(`/error`);
      }
    }
    req.session.discord_id = user.id;
    req.session.email = user.email;
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    req.session.token_expiration = (unix+data.expires_in);
    req.session.user_name = member.user.username;

    let user_data = [req.session.discord_id, member.user.username, req.session.email, data.access_token, data.refresh_token, req.session.token_expiration]
    database.runQuery(`INSERT IGNORE INTO stripe_users (user_id, user_name, email, access_token, refresh_token, token_expiration) VALUES (?, ?, ?, ?, ?, ?)`, user_data);
    database.runQuery(`UPDATE IGNORE stripe_users SET access_token = ?, refresh_token = ?, token_expiration = ? WHERE user_id = ?`, [data.access_token, data.refresh_token, req.session.token_expiration, user.id]);

    try {
      dbuser = await database.fetchUser(req.session.discord_id);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Database User", e);
      return res.redirect(`/error`);
    }
    let dbChecked = false;
    if (req.session.email != dbuser.email || req.session.user_name != dbuser.user_name) {
      try {
        await database.runQuery(`UPDATE IGNORE stripe_users SET email = ?, user_name = ? WHERE user_id = ?`, [req.session.email, req.session.user_name, dbuser.user_id]);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to update Database User", e);
        return res.redirect(`/error`);
      }
      console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.user_name+ ","+req.session.email+" Formerly: "+dbuser.user_name+","+dbuser.email);
      dbChecked = true;
    } else {
      dbChecked = true;
    }
    let stripeChecked = false;
    let customer;
    if (!dbuser.stripe_id) {
      try {
        customer = await stripe.customer.create(req.session.user_name, req.session.discord_id, req.session.email);
        dbuser.stripe_id = customer.id;
        stripeChecked = true;
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Create Stripe Customer", e);
        return res.redirect(`/error`);
      }
    } else if (dbuser.manual == 'true') { 
      return res.redirect(`/manual`); 
    } else {
      try {
        customer = await stripe.customer.fetch(dbuser.stripe_id);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Fetch Stripe Customer", e);
        return res.redirect(`/error`);
      }
    }
    if (stripeChecked == false && customer && customer != 'ERROR') {
      console.info("["+bot.getTime("stamp")+"] [wall.js] Found Stripe Info for User "+req.session.user_name);
      if (req.session.discord_id != customer.description) {
        bot.sendDM(member, "Error Logging In", "Please contact administration for further assistance", "FF0000");
        bot.sendEmbed(member, "FF0000", "User ID Discrepancy Found", "User "+dbuser.user_name+"'s Discord ID ("+req.session.discord_id+") not found on matched Stripe Record ("+customer.id+","+customer.description+")", config.discord.log_channel);
        return res.redirect(`/error`);
      }
      if (req.session.email != customer.email || req.session.user_name != customer.name) {
        try {
          await stripe.customer.update(dbuser.stripe_id, req.session.email, req.session.user_name);
        } catch (e) {
          req.session = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Stripe Customer", e);
          return res.redirect(`/error`);
        }
      }
      if (customer.subscriptions.total_count > 0) {
        if (customer.subscriptions.data[0].items.data[0].price.id && !dbuser.price_id || dbuser.price_id && customer.subscriptions.data[0].items.data[0].price.id && dbuser.price_id != customer.subscriptions.data[0].items.data[0].price.id) {
          try {
            await database.runQuery(`UPDATE stripe_users SET price_id = ? WHERE user_id = ?`, [customer.subscriptions.data[0].items.data[0].price.id, dbuser.user_id]);
          } catch (e) {
            req.session = null;
            console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Subscription Price Record", e);
            return res.redirect(`/error`);
          }
          console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.user_name+ ","+req.session.email+"(Invalid/Missing Plan Updated)");
          dbuser.price_id = customer.subscriptions.data[0].items.data[0].price.id;
        }
      }
      if (dbuser.price_id) {
        if (customer.subscriptions.total_count == 0 && dbuser.temp_plan_expiration < unix) {
          try {
            await database.runQuery(`UPDATE stripe_users SET price_id = NULL WHERE user_id = ?`, [dbuser.user_id]);
          } catch (e) {
            req.session = null;
            console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Temp Access Price Record", e);
            return res.redirect(`/error`);
          }
          console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.user_name+ ","+req.session.email+"(Invalid Plan Deleted)");
          dbuser.price_id = null;
        }
      }
      stripeChecked = true;
    }
    if (dbChecked == false || stripeChecked == false) {
      bot.sendDM(member, "Error Logging In", "Please contact administration for further assistance", "FF0000");
      bot.sendEmbed(member, "FF0000", "Login Flow Error", "User "+req.session.user_name+" DB Pass = "+dbChecked+", Stripe Pass = "+stripeChecked, config.discord.log_channel);
      return res.redirect(`/error`);
    } else {
      req.session.login = true;
      req.session.stripe_id = dbuser.stripe_id;
      if (dbuser.price_id && dbuser.temp_plan_expiration == null) {
        return res.redirect(`/manage`);
      } else if(dbuser.price_id && dbuser.temp_plan_expiration != null && dbuser.temp_plan_expiration > unix) {
        req.session.expiry = dbuser.temp_plan_expiration;
        return res.redirect(`/expiry`);
      } else {
      return res.redirect(`/checkout`);
      }
    }
  }
});
//------------------------------------------------------------------------------
//  PRODUCTS CHECKOUT PAGE
//------------------------------------------------------------------------------
server.get("/checkout", async function(req, res) {
  if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let checkoutbody = '';
    for (let i = 0; i < config.stripe.price_ids.length; i++) {
console.log(config.stripe.price_ids[i].mode);
      let pricehtml = '<div><h2>'+config.stripe.price_ids[i].title+'</h2><p><strong>'+config.stripe.price_ids[i].text+'</strong></p><form action="/create-checkout-session" method="post"><input type="hidden" name="priceID" value="'+config.stripe.price_ids[i].id+'" /><input type="hidden" name="mode" value="'+config.stripe.price_ids[i].mode+'" /><input type="hidden" name="customerID" value="'+req.session.stripe_id+'" /><button type="submit">Continue</button></form></div><br><hr>';
      checkoutbody = checkoutbody+pricehtml;
    }
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/checkout.html", {
      welcome: config.pages.checkout.welcome,
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      checkoutbody: checkoutbody,
      map_name: config.map_name,
      map_url: config.map_url,
      radar_script: radar_script,
      user_name: req.session.user_name,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  STRIPE CHECKOUT
//------------------------------------------------------------------------------
server.post("/create-checkout-session", async (req, res) => {
  return stripe.sessions.checkout(req, res);
});
//------------------------------------------------------------------------------
//  CUSTOMER PORTAL PAGE
//------------------------------------------------------------------------------
server.get("/manage", async function(req, res) {
  if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/manage.html", {
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      customerID: req.session.stripe_id,
      map_name: config.map_name,
      map_url: config.map_url,
      radar_script: radar_script,
      user_name: req.session.user_name,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER PORTAL
//------------------------------------------------------------------------------
server.post("/create-customer-portal-session", async (req, res) => {
  return stripe.sessions.portal(req, res);
});
//------------------------------------------------------------------------------
//  ACTIVE ONE-TIME CUSTOMER PAGE
//------------------------------------------------------------------------------
server.get("/expiry", async function(req, res) {
  if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let expiry = new Date(req.session.expiry * 1000).toLocaleString(config.pages.expiry.tz_locale, { timeZone: config.pages.expiry.time_zone });
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/expiry.html", {
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      customerID: req.session.stripe_id,
      expiry: expiry,
      tz_text: config.pages.expiry.tz_text,
      map_name: config.map_name,
      map_url: config.map_url,
      radar_script: radar_script,
      user_name: req.session.user_name,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  MANUAL/LIFETIME USER PAGE
//------------------------------------------------------------------------------
server.get("/manual", async function(req, res) {
    if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/manual.html", {
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      map_name: config.map_name,
      map_url: config.map_url,
      radar_script: radar_script,
      user_name: req.session.user_name,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  BLOCKED PAGE
//------------------------------------------------------------------------------
server.get("/blocked", async function(req, res) {
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/blocked.html", {
    terms: config.pages.general.terms,
    warning: config.pages.general.warning,
    map_name: config.map_name,
    map_url: config.map_url,
    radar_script: radar_script
  });
});
//------------------------------------------------------------------------------
//  ERROR PAGE
//------------------------------------------------------------------------------
server.get("/error", async function(req, res) {
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/error.html", {
    terms: config.pages.general.terms,
    warning: config.pages.general.warning,
    map_name: config.map_name,
    map_url: config.map_url,
    radar_script: radar_script
  });
});
//------------------------------------------------------------------------------
//  SRIPE WEBHOOKS
//------------------------------------------------------------------------------
server.post("/webhook", async (req, res) => {
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
      console.info("⚠️  Webhook signature verification failed.", e);
      return res.sendStatus(400);
    }
    data = event.data;
    eventType = event.type;
  } else {
    data = req.body.data;
    eventType = req.body.type;
  }
  res.sendStatus(200);
  console.log(eventType);
  return console.log(data);
  //return stripe.webhookParse(data, eventType);
});
//------------------------------------------------------------------------------
//  STRIPE, DATABASE, ROLE & DISCORD INFO MAINTENANCE
//------------------------------------------------------------------------------
ontime({
  cycle: config.sync
}, function(ot) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Maintenance Routines.");
  database.checkDetails();
  ot.done();
  return;
});
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.listening_port, () => {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Now Listening on port "+config.listening_port+".");
});