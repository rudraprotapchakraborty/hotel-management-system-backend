const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
require('dotenv').config();
const axios = require("axios");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const formData = require('form-data');
const Mailgun = require('mailgun.js');
const mailgun = new Mailgun(formData);
const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y7jbt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server (optional startFing in v4.7)
    // await client.connect();

    const userCollection = client.db('hotelDb').collection('users');
    const mealCollection = client.db('hotelDb').collection('meal');
    const reviewCollection = client.db('hotelDb').collection('reviews');
    const cartCollection = client.db('hotelDb').collection('carts');
    const paymentCollection = client.db('hotelDb').collection('payments');
    const membershipCollection = client.db('hotelDb').collection('membership');
    const requestCollection = client.db('hotelDb').collection('requests');

    //jwt related apis
    app.post('/jwt', (req, res) => {
      const token = jwt.sign(req.body, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    });

    //middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send('Unauthorized request');
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send('Token is not valid');
        }
        req.decoded = decoded;
        next();
      });
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send('Unauthorized request');
      }
      next();
    };

    // Endpoint: Get all memberships
    app.get('/membership', async (req, res) => {
      const cursor = membershipCollection.find({});
      const membership = await cursor.toArray();
      res.send(membership);
    });

    app.get('/membership/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const membership = await membershipCollection.findOne(query);
      res.send(membership);
    });

    // Endpoint: Get all users
    app.get('/users', async (req, res) => {
      const cursor = userCollection.find({});
      const users = await cursor.toArray();
      res.send(users);
    });

    app.get('/users/:email', async (req, res) => {
      const { email } = req.params;
      const user = await userCollection.findOne({ email: email });

      if (user) {
        res.send(user);
      } else {
        res.status(404).send({ message: 'User not found' });
      }
    });


    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send('Unauthorized request');
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      res.send({ admin });
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        res.send({ status: 'User already exists' });
        return;
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // Endpoint: Get all meals with search, filter, and pagination
    app.get('/meal', async (req, res) => {
      const {
        search = '',
        category = '',
        minPrice = 0,
        maxPrice = 500,
        page = 1,
        limit = 100,
        upcoming
      } = req.query;

      const query = {
        ...(search && { name: { $regex: search, $options: 'i' } }),
        ...(category && { category }),
        price: { $gte: parseFloat(minPrice), $lte: parseFloat(maxPrice) },
        ...(upcoming === 'true' && { upcoming: true })
      };

      const options = {
        skip: (parseInt(page) - 1) * parseInt(limit),
        limit: parseInt(limit),
      };

      try {
        const meal = await mealCollection.find(query, options).toArray();
        res.send(meal);
      } catch (error) {
        console.error("Error fetching meals:", error);
        res.status(500).send({ error: "Failed to fetch meals" });
      }
    });

    app.get('/meal/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const meal = await mealCollection.findOne(query);
      res.send(meal);
    });

    app.post('/meal', verifyToken, verifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await mealCollection.insertOne(item);
      res.send(result);
    });

    app.patch('/meal/:id', async (req, res) => {
      const item = req.body;  // The body contains fields to update (name, category, etc.)
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };

      // Prepare update fields
      const updatedDoc = {
        $inc: { likes: 1 },  // Increment the likes count by 1 (if needed)
        $set: {}  // To set the other fields if provided
      };

      // Convert likes to a number if it is stored as a string
      if (item.likes) {
        updatedDoc.$set.likes = Number(item.likes);
      }

      // Check if fields are present and update accordingly
      if (item.name) updatedDoc.$set.name = item.name;
      if (item.category) updatedDoc.$set.category = item.category;
      if (item.price) updatedDoc.$set.price = item.price;
      if (item.recipe) updatedDoc.$set.recipe = item.recipe;
      if (item.image) updatedDoc.$set.image = item.image;

      // If a review is provided, update the reviews array, including the user's email
      if (item.user && item.review && item.email) {
        updatedDoc.$push = {
          reviews: { user: item.user, review: item.review, email: item.email }
        };
      }

      try {
        // Update the meal in the database
        const result = await mealCollection.updateOne(filter, updatedDoc);

        if (result.modifiedCount > 0) {
          // Successfully updated, send back the updated meal data
          const updatedMeal = await mealCollection.findOne(filter);
          res.send({
            success: true,
            meal: updatedMeal,
          });
        } else {
          res.send({ success: false, message: "No changes made" });
        }
      } catch (error) {
        console.error("Error updating meal reviews:", error);
        res.status(500).send({ success: false, message: "Error updating the meal.", error: error.message });
      }
    });


    app.delete('/meal/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealCollection.deleteOne(query);
      res.send(result);
    });

    // Endpoint: Get reviews
    app.get('/reviews', async (req, res) => {
      const cursor = reviewCollection.find({});
      const reviews = await cursor.toArray();
      res.send(reviews);
    });

    // Endpoint: Get cart
    app.get('/carts', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/carts', async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete('/carts/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    //payment intent
    app.get('/payments/:email', verifyToken, async (req, res) => {
      const query = { email: req.params.email };
      if (req.params.email !== req.decoded.email) {
        return res.status(403).send('Unauthorized request');
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price) * 100;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post('/payments', async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      const query = {
        _id: {
          $in: payment.cartIds.map(id => new ObjectId(id))
        }
      }
      const deleteResult = await cartCollection.deleteMany(query);

      mg.messages.create(process.env.MAILGUN_DOMAIN, {
        from: "Mailgun Sandbox <postmaster@sandboxa379b56c48ee4b349372a8b5715ce9bb.mailgun.org>",
        to: ["Rudra Protap Chakraborty <rudra.phymos@gmail.com>"],
        subject: "Thank you for your order on Hotel Management!",
        text: "Testing some Mailgun awesomness!",
        html: `
          <div>
          <h2>Thank you for your order</h2>
          <h4>Your transaction ID: <strong>${payment.transactionId}</strong></h4>
          <p>We would like to get your feedback for the food.</p>
          </div>
        `
      })
        .then(msg => console.log(msg)) // logs response data
        .catch(err => console.error(err)); // logs any error

      res.send({ paymentResult, deleteResult });
    });

    app.post("/create-ssl-payment", async (req, res) => {
      const payment = req.body;
      console.log("payment info", payment);

      const trxid = new ObjectId().toString();
      payment.transactionId = trxid;

      const initiate = {
        store_id: 'hotel679f2336d4faf',
        store_passwd: 'hotel679f2336d4faf@ssl',
        total_amount: payment.price,
        currency: 'BDT',
        tran_id: trxid,
        success_url: 'https://hotel-management-25cdc.web.app/dashboard/paymentHistory',
        fail_url: 'https://hotel-management-25cdc.web.app/dashboard/paymentHistory',
        cancel_url: 'https://hotel-management-25cdc.web.app/dashboard/paymentHistory',
        ipn_url: 'https://hotel-management-25cdc.web.app/dashboard/paymentHistory',
        shipping_method: 'Courier',
        product_name: 'Computer.',
        product_category: 'Electronic',
        product_profile: 'general',
        cus_name: 'Customer Name',
        cus_email: `${payment.email}`,
        cus_add1: 'Dhaka',
        cus_add2: 'Dhaka',
        cus_city: 'Dhaka',
        cus_state: 'Dhaka',
        cus_postcode: '1000',
        cus_country: 'Bangladesh',
        cus_phone: '01711111111',
        cus_fax: '01711111111',
        ship_name: 'Customer Name',
        ship_add1: 'Dhaka',
        ship_add2: 'Dhaka',
        ship_city: 'Dhaka',
        ship_state: 'Dhaka',
        ship_postcode: 1000,
        ship_country: 'Bangladesh',
      }

      const iniResponse = await axios({
        url: 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php',
        method: 'POST',
        data: initiate,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      const saveData = await paymentCollection.insertOne(payment);
      const gatewayUrl = iniResponse?.data?.GatewayPageURL;
      res.send({ gatewayUrl });
    });

    app.post("/success-payment", async (req, res) => {
      const paymentSuccess = req.body;

      const { data } = await axios.get(`https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php?val_id=${paymentSuccess.val_id}&store_id=hotel679f2336d4faf&store_passwd=hotel679f2336d4faf@ssl&format=json`)
      if (data.status !== 'VALID') {
        return res.send({ message: "Invalid payment" })
      }

      const updatePayment = await paymentCollection.updateOne({ transactionId: data.tran_id }, {
        $set: {
          status: "success",
        }
      })

      const payment = await paymentCollection.findOne({
        transactionId: data.tran_id,
      })

      const query = {
        _id: {
          $in: payment.cartIds.map((id) => new ObjectId(id)),
        }
      }

      const deleteResult = await cartCollection.deleteMany(query);

      res.redirect('http://localhost:5173/dashboard/cart')
    });


    // Endpoint: Store meal requests
    app.post("/requests", async (req, res) => {
      console.log("Received Data:", req.body); // Log incoming request

      const { email, mealName, image, time } = req.body;

      if (!email || !mealName || !image || !time) {
        console.error("Missing fields:", { email, mealName, image, time });
        return res.status(400).json({ success: false, message: "All fields are required." });
      }

      try {
        const result = await requestCollection.insertOne({ email, mealName, image, time });
        res.json({ success: true, result });
      } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ success: false, message: "Server error." });
      }
    });


    // Endpoint: Get all meal requests
    app.get('/requests', async (req, res) => {
      try {
        const requests = await requestCollection.find({}).toArray();
        res.send(requests);
      } catch (error) {
        console.error("Error fetching meal requests:", error);
        res.status(500).send({ success: false, message: "Server error." });
      }
    });



    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    // console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Root endpoint
app.get('/', (req, res) => {
  res.send('Hotel Management Server is running');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});