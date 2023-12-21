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

//------------------------------------------------------------------------------
//  SERVER CONFIGURATIONS
//------------------------------------------------------------------------------
var sessionAge = 86400000;
const server = express();
server.engine("html", require("ejs").renderFile);
server.use(cookieSession({
  name: "session",
  keys: [config.server.session_key],
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
// LANDING PAGE
//------------------------------------------------------------------------------

// Render the main page with /login link

//------------------------------------------------------------------------------
//  LOGIN/OAUTH FLOW
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix = moment().unix();
  req.session.now = unix;
  req.session.discord_id = null;
  req.session.username = null;
  req.session.email = null;
  req.session.access_token = null;
  req.session.refresh_token = null;
  req.session.token_expiration = null;
  req.session.customer_type = null;
  req.session.terms_reviewed = null;
  req.session.zones_reviewed = null;
  req.session.stripe_id = null;
  req.session.price_id = null;
  req.session.expiration = null;
  req.session.total_spend = null;
  req.session.total_votes = null;
  req.session.zone_votes = null;
  req.session.login = false;
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
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Tokens", e);
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
    req.session.discord_id = user.id;
    req.session.username = user.username;
    req.session.email = user.email;
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    req.session.token_expiration = (unix+data.expires_in);
    try {
      if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
        console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Login Attempt.");
        bot.sendEmbed(req.session.username, req.session.discord_id, "FF0000", "Blacklist Login Attempt", "", config.discord.log_channel);
        return res.redirect(`/blocked`);
      } else { 
        console.info("["+bot.getTime("stamp")+"] [wall.js] User Passed Blacklist");
      }
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Check Failure", e);
      return res.redirect(`/error`)
    }
    try {
      member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.id);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Guild Member Fetch Failure", e);
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
    }
    try {
      database.runQuery(`INSERT INTO stripe_users (user_id, user_name, email, access_token, refresh_token, token_expiration) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), email=VALUES(email), access_token=VALUES(access_token), refresh_token=VALUES(refresh_token), token_expiration=VALUES(token_expiration)`, [req.session.discord_id, req.session.username, req.session.email, req.session.access_token, req.session.refresh_token, req.session.token_expiration]);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Insert/Update Database User", e);
      return res.redirect(`/error`);
    }
    try {
      dbuser = await database.fetchUser(req.session.discord_id);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Database User", e);
      return res.redirect(`/error`);
    }
    req.session.customer_type = dbuser.customer_type;
    req.session.terms_reviewed = dbuser.terms_reviewed;
    req.session.zones_reviewed = dbuser.zones_reviewed;
    let customer;
    if (!dbuser.stripe_id) {
      try {
        customer = await stripe.customer.create(req.session.username, req.session.discord_id, req.session.email);
        dbuser.stripe_id = customer.id;
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Create Stripe Customer", e);
        return res.redirect(`/error`);
      }
    } else {
      try {
        customer = await stripe.customer.fetch(dbuser.stripe_id);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Fetch Stripe Customer", e);
        return res.redirect(`/error`);
      }
    }
    req.session.stripe_id = dbuser.stripe_id;
    if (dbuser.expiration) { req.session.expiration = dbuser.expiration; }
    if (customer && customer != 'ERROR') {
      console.info("["+bot.getTime("stamp")+"] [wall.js] Found Stripe Info for User "+req.session.username);
      if (req.session.discord_id != customer.description) {
        bot.sendEmbed(req.session.username, req.session.discord_id, "FF0000", "User ID Discrepancy Found", "User "+dbuser.user_name+"'s Discord ID ("+req.session.discord_id+") not found on matched Stripe Record ("+customer.id+","+customer.description+")", config.discord.log_channel);
        return res.redirect(`/error`);
      }
      if (req.session.email != customer.email || req.session.username != customer.name) {
        try {
          await stripe.customer.update(dbuser.stripe_id, req.session.email, req.session.username);
        } catch (e) {
          req.session = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Stripe Customer", e);
          return res.redirect(`/error`);
        }
      }
      if (customer.subscriptions && customer.subscriptions.total_count > 0) {
        for (let i = 0; i < config.stripe.price_ids.length; i++) {
          for (let x = 0; x < customer.subscriptions.data.length; x++) {
            if (customer.subscriptions.data[x].status == 'active' && customer.subscriptions.data[x].items.data[0].price.id && customer.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
              if (!dbuser.price_id || dbuser.price_id && dbuser.price_id != customer.subscriptions.data[x].items.data[0].price.id || !dbuser.expiration || dbuser.expiration && dbuser.expiration != customer.subscriptions.data[x].current_period_end) {
                try {
                  await database.runQuery(`UPDATE stripe_users SET price_id = ?, expiration = ? WHERE user_id = ?`, [customer.subscriptions.data[x].items.data[0].price.id, customer.subscriptions.data[x].current_period_end, dbuser.user_id]);
                } catch (e) {
                  req.session = null;
                  console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Subscription Price Record", e);
                  return res.redirect(`/error`);
                }
                dbuser.price_id = customer.subscriptions.data[x].items.data[0].price.id;
                dbuser.expiration = customer.subscriptions.data[x].current_period_end;
                console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.username+ ","+req.session.email+"(Invalid/Missing Plan Updated)");
              }
            }
          }
        }
      }
      if (dbuser.price_id) {
        req.session.price_id = dbuser.price_id;
        if (dbuser.expiration && dbuser.expiration < unix) {
          try {
            await database.runQuery(`UPDATE stripe_users SET price_id = NULL, expiration = NULL WHERE user_id = ?`, [dbuser.user_id]);
          } catch (e) {
            req.session = null;
            console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Temp Access Price Record", e);
            return res.redirect(`/error`);
          }
          dbuser.price_id = null;
          dbuser.expiration = null;
          req.session.price_id = null;
          req.session.expiration = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.username+ ","+req.session.email+"(Invalid Plan Deleted)");
        }
      }
    }
  if (dbuser.total_spend) { req.session.total_spend = dbuser.total_spend; }
  if (dbuser.total_votes) { req.session.total_votes = dbuser.total_votes; }
  if (dbuser.zone_votes) { req.session.zone_votes = dbuser.total_votes; } // Not sure if doing work here yet, or just reading and setting
  req.session.login = true;
  //Page selection logic here
  
  }
});
//------------------------------------------------------------------------------
//  NEW USER PAGE
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
//  EXISTING USER PAGE
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
//  ZONE MAP PAGE
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
//  WORKER RESULT PAGE
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
//  STRIPE CHECKOUT
//------------------------------------------------------------------------------
server.post("/create-checkout-session", async (req, res) => {
  return stripe.sessions.checkout(req, res);
});
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER PORTAL
//------------------------------------------------------------------------------
server.post("/create-customer-portal-session", async (req, res) => {
  return stripe.sessions.portal(req, res);
});
//------------------------------------------------------------------------------
//  LIFETIME ACTIVE TOGGLE
//------------------------------------------------------------------------------
server.post("/lifetime-toggle", async (req, res) => {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600 || !req.body) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    if (req.body.action == "activate") {
      bot.assignRole(req.session.discord_id, config.discord.lifetime_role);
      bot.removeRole(req.session.discord_id, config.discord.inactive_lifetime_role);
      database.runQuery('UPDATE stripe_users SET expiration = ? WHERE user_id = ?', [9999999999, req.session.discord_id]);
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
    } else if (req.body.action == "deactivate") {
      bot.assignRole(req.session.discord_id, config.discord.inactive_lifetime_role);
      bot.removeRole(req.session.discord_id, config.discord.lifetime_role);
      database.runQuery('UPDATE stripe_users SET expiration = ? WHERE user_id = ?', [9999999998, req.session.discord_id]);
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
    } else {
      return res.redirect(`/error`);
    }
  }
});
//------------------------------------------------------------------------------
//  BLOCKED PAGE
//------------------------------------------------------------------------------
server.get("/blocked", async function(req, res) {
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/blocked.html", {
    background: config.pages.blocked.background,
    outer_background: config.pages.blocked.outer_background,
    border_color: config.pages.blocked.border_color,
    title_color: config.pages.blocked.title_color,
    button_link: config.pages.blocked.button_link,
    button_text: config.pages.blocked.button_text,
    site_name: config.server.site_name,
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
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script
  });
});
//------------------------------------------------------------------------------
//  PRODUCTS CHECKOUT PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/checkout", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.customer_type == 'true' && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/manual`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix) {
    return res.redirect(`/expiry`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else {
    let checkoutbody = '';
    for (let i = 0; i < config.stripe.price_ids.length; i++) {
      if (config.stripe.price_ids[i].mode != 'legacy') {
        let pricehtml = '<div><h2><font color="'+config.pages.general.title_color+'">'+config.stripe.price_ids[i].title+'</font></h2><p><strong><font color="'+config.pages.general.text_color+'">'+config.stripe.price_ids[i].text+'</font></strong></p><form action="/create-checkout-session" method="post"><input type="hidden" name="priceID" value="'+config.stripe.price_ids[i].id+'" /><input type="hidden" name="mode" value="'+config.stripe.price_ids[i].mode+'" /><input type="hidden" name="customerID" value="'+req.session.stripe_id+'" /><button type="submit">Continue</button></form></div><br><hr>';
        checkoutbody = checkoutbody+pricehtml;
      }
    }
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/checkout.html", {
      welcome: config.pages.checkout.welcome,
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      checkoutbody: checkoutbody,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  CUSTOMER PORTAL PAGE  (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/manage", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' -  Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.customer_type == 'true' && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/manual`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && req.session.expiration && req.session.expiration-86400 > unix) {
    return res.redirect(`/expiry`);
  } else if (!req.session.price_id) {
    return res.redirect(`/checkout`);
  } else {
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/manage.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      customerID: req.session.stripe_id,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  ACTIVE ONE-TIME CUSTOMER PAGE  (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/expiry", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' -   Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.customer_type == 'true' && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/manual`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.price_id) {
    return res.redirect(`/checkout`);
  } else {
    let expiry = new Date(req.session.expiration * 1000).toLocaleString(config.server.tz_locale, { timeZone: config.server.time_zone });
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/expiry.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      customerID: req.session.stripe_id,
      expiry: expiry,
      tz_text: config.server.tz_text,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  MANUAL USER PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/manual", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix) {
    return res.redirect(`/expiry`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.customer_type || req.session.customer_type && req.session.expiration-86400 < unix) {
    return res.redirect(`/checkout`);
  } else {
    let intro = config.pages.manual.manual_intro;
    let exp_text = config.pages.manual.manual_text;
    let expiry = new Date(req.session.expiration * 1000).toLocaleString(config.server.tz_locale, { timeZone: config.server.time_zone });
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/manual.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      expiry: expiry,
      tz_text: config.server.tz_text,
      intro: intro,
      exp_text: exp_text,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  ACTIVE LIFETIME USER PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/lifetime-active", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/expiry`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.customer_type || req.session.customer_type && req.session.expiration-86400 < unix) {
    return res.redirect(`/checkout`);
  } else {
    let intro = config.pages.lifetime.active_life_intro;
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/lifetime-active.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      intro: intro,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      user_id: req.session.discord_id,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  INACTIVE LIFETIME USER PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/lifetime-inactive", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/expiry`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.customer_type || req.session.customer_type && req.session.expiration-86400 < unix) {
    return res.redirect(`/checkout`);
  } else {
    let intro = config.pages.lifetime.inactive_life_intro;
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/lifetime-inactive.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      intro: intro,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      user_id: req.session.discord_id,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  SRIPE WEBHOOKS
//------------------------------------------------------------------------------
server.post("/webhook", async (req, res) => {
  return stripe.webhookVerify(req, res);
});
//------------------------------------------------------------------------------
//  STRIPE, DATABASE, ROLE & DISCORD INFO MAINTENANCE
//------------------------------------------------------------------------------
ontime({
  cycle: config.sync.times
}, function(ot) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Maintenance Routines.");
  database.checkDetails();
  ot.done();
  return;
});
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.server.listening_port, () => {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Now Listening on port "+config.server.listening_port+".");
});