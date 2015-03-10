var express = require('express');
var exphbs = require('express-handlebars');
var bodyParser = require("body-parser");
var nodeRestClient = require('node-rest-client').Client;
var session = require('express-session');
var cookieParser = require('cookie-parser');
var flash = require('connect-flash');
var csrf = require('csurf');
var uuid = require('node-uuid');
var node_cache = require("node-cache");
var app = express();




/**
 * Payoint processing details and enpoint
 *
 */

var config = require('./config.json');

var apiBaseUrl ;
if(config.pp_env == "MITE"){
    apiBaseUrl = "https://api.mite.paypoint.net:2443";
}else if(env == "PROD"){
    apiBaseUrl = "https://api.paypoint.net"
}


/**
 * Main application code  - setup
 */

/**
 * This is a fake DB of payment state - which currently a TTL cache.
 */
var paymentsDB = new node_cache({stdTTL: 3600, checkPeriod: 120});

var csrfProtection = csrf({ cookie: true })

app.engine('handlebars', exphbs({defaultLayout: 'main'}));
app.set('view engine', 'handlebars');
app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + "/static"));
app.use(bodyParser.urlencoded({extended: false}));
app.use(cookieParser('8JzTXNxob9b0s'));
app.use(session({
    cookie: {maxAge: 60000},
    saveUninitialized: false,
    resave: false,
    secret: 'B8N2nhvbkqELA'
}));


app.use(flash());

// Global view attributes
app.use(function (req, res, next) {
        res.locals.cardlock_pubid = config.pp_cardlock_publishableid;
        res.locals.cardlock_endpoint = apiBaseUrl + "/cardlock/scripts/cardLock.js";
        res.locals.errorMsg = req.flash("errorMsg");
        next();
    }
);

/**
 * start payment handler, creates a payment with some random settings and a random ID,
 * redirects to the start payment page
 */
app.get('/', function (req, res, next) {
    var id = uuid.v4();
    var payment = {
        state: "UNPAID",
        id: id,
        amount: 150.00,
        currency: "GBP",
        desc: "Sample Transaction"
    };

    // Store the payment in the cache
    paymentsDB.set(id, payment);

    res.redirect("/payment/" + id + "/")
});


/**
 * Payments handling
 */

var paymentRouter = express.Router();

app.use("/payment/",paymentRouter);

/**
 * Pick out and load the payment for each payment request
 */
paymentRouter.param("paymentId",function (req, res, next,paymentId) {
    console.log("loading payment data for payment ",paymentId);
    var dbResult = paymentsDB.get(paymentId);
    if (!dbResult[paymentId]){
        console.log("Payment not found ",paymentId);
        res.sendStatus(404);
        return;
    }

    req.payment =res.locals.payment=   dbResult[paymentId];
    next();
});

/**
 * Payment resource - dispatches to the appropriate view depending on the state of the payment object in the DB
 */
paymentRouter.get('/:paymentId/',csrfProtection, function (req, res, next) {
    res.locals.csrfToken = req.csrfToken()
    if (req.payment.state == 'UNPAID') {
        res.render("payment_form", {payment: req.payment});
    } else if(req.payment.state == 'PAID') {
        res.render("payment_complete", {payment: req.payment});
    }else{
        res.sendStatus(500);
    }
});



/**
 * Payment processing handler makes a REST call to the PayPoint payments service to complete a payment
 */

/**
 * Create a REST client to talk to the server
 *
 */
var ppApiClient = new nodeRestClient({
    user: config.pp_api_user,
    password: config.pp_api_secret
});

function errorRedirect(req, res, id, message) {
    console.log("sending error page to ",id, " with error ",message );
    req.flash("errorMsg", message);
    res.redirect("/payment/" + id + "/");
}


ppApiClient.registerMethod("payment", apiBaseUrl + "/acceptor/rest/transactions/${installationId}/payment", "POST");

paymentRouter.post('/:paymentId/process-payment', csrfProtection, function (req, res, next) {

    if (req.payment.state === "PAID") {
        console.log("duplicate payment ", req.payment.id);
        res.redirect('/payment/' + req.payment.id + "/");
        return;
    }

    console.log("Got payment request with body", req.body);

    var cardLockToken = req.body.card_lock_token;
    var expiry = req.body.expiry_month + "" + req.body.expiry_year;
    var cardholder =req.body.card_holder_name;
    console.log("Submitting request with token ", cardLockToken, " and expiry", expiry);

    // Payment Transaction Data
    var paymentData = {
        "transaction": {
            "currency": req.payment.currency,
            "amount": req.payment.amount,
            "description": req.payment.description,
            "merchantRef": req.payment.id,
            "commerceType": "ECOM",
            "deferred": "true"
        },
        "paymentMethod": {
            "card": {
                "cardLockToken": cardLockToken,
                "expiryDate": expiry,
                "nickname": "Default Card",
                "cardHolderName": cardholder,
                "defaultCard": true
            }
        },
        "customer": {
            "displayName":cardholder,
            "merchantRef": req.payment.id
        }
    };

    var args = {
        path: {installationId: config.pp_api_installation},
        data: paymentData,
        headers: {"Content-Type": "application/json"}
    };

    console.log("Sending request ", args);

    ppApiClient.methods.payment(args, function (data, response) {
        console.log("got response ", data, response.statusCode);

        if (response.statusCode == 201) {
            req.payment.state = "PAID";
            req.payment.response = data;
            paymentsDB.set(req.payment.id, req.payment);

            res.redirect('/payment/' + req.payment.id + "/");
        } else {
            var message;
            if (data.hasOwnProperty("reasonMessage")) {
                // Internal error - validation failure etc.
                message = data.reasonMessage;
            } else if (data.hasOwnProperty("outcome")) {
                // Transaction failed , e.g. declined or blocked by fraud
                message = data.outcome.reasonMessage;
            }
            errorRedirect(req, res, req.payment.id, message);
        }
    }).on("error", function (err) {
        // HTTP error
        console.log("payment error", err);
        errorRedirect(req, res, id, "Error communicating with payment provider");
    });
});


paymentRouter.get('/:paymentId/complete', function (req, res, next) {
    if (req.payment.state != "PAID" ||  req.payment.response == null) {
        console.log("Invalid state, payment not complete");
        res.redirect("/" + req.payment.id + "/");
    }
    res.render('payment_form');
})
;


var server = app.listen(app.get('port'), function () {
    console.log('Listening on port %d', server.address().port);
});

