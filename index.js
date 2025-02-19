import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { format } from 'date-fns';

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set the views directory
app.set('views', path.join(__dirname, 'Views'));
// Set the view engine to ejs
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('Public'));

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/img');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

let books = [];
let notes = [];

async function getBooks() {
    const result = await db.query('SELECT * FROM books ORDER BY id DESC');
    const books = result.rows;

    // Convert book_cover to base64
    for (let book of books) {
        if (book.book_cover) {
            book.book_cover = `${book.book_cover.toString('base64')}`;
        }
        if (book.book_date) {
            book.book_date = format(new Date(book.book_date), 'MMMM d, yyyy');
        }
    }

    return books;
}

async function getBook(id) {
    const result = await db.query('SELECT * FROM books WHERE id = $1', [id]);
    const book = result.rows[0];

    if (book.book_cover) {
        book.book_cover = `${book.book_cover.toString('base64')}`;
    }
    if (book.book_date) {
        book.book_date = format(new Date(book.book_date), 'MMMM d, yyyy');
    }

    return book;
}

async function getNotes(id) {
    try {
        const result = await db.query('SELECT notes FROM notes WHERE book_id = $1', [id]);
        if (result.rows.length === 0) {
            return [];
        }
        let notes = result.rows[0].notes;

        // Sort notes by latest (assuming each note has a timestamp or id)
        notes.sort((a, b) => {
            // Assuming each note has a 'timestamp' property
            return new Date(b.timestamp) - new Date(a.timestamp);
        });

        console.log('Notes:', notes);
        return notes;
    } catch (error) {
        console.error('Error fetching notes:', error);
        throw error;
    }
}

async function addNotes(id, note) {
    try {
      const result =  await db.query('SELECT notes FROM notes WHERE book_id = $1', [id]);
        if(result.rows.length === 0) {
            await db.query('INSERT INTO notes (book_id, notes) VALUES ($1, $2)', [id, [note]]);
            return;
        }else{
            const notes = result.rows[0].notes;
            notes.push(note);
            await db.query('UPDATE notes SET notes = $1 WHERE book_id = $2', [notes, id]);
        }

    } catch (error) {
        console.error('Error adding notes:', error);
        throw error;
    }
}

app.get('/', async (req, res) => {
    try {
        books = await getBooks();
        res.render('index', { itemBooks: books });
    } catch (error) {
        console.log(error);
    }
});

app.get('/addButton', (req, res) => {
    res.render('add');
});

app.post('/addBook', upload.single('book_cover'), async (req, res) => {
    const { book_title, book_author, book_des, book_date } = req.body;
    const book_cover = req.file ? fs.readFileSync(req.file.path) : null;

    if (!book_cover) {
        console.error('No file buffer received');
        return res.status(400).send('No file uploaded');
    }

    try {
        await db.query('INSERT INTO books (book_title, book_author, book_des, book_cover, book_date) VALUES ($1, $2, $3, $4, $5)',
            [book_title, book_author, book_des, book_cover, book_date]);
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving book');
    }
});

app.get('/bookNotes/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const book = await getBook(id);
        const bookNotes = await getNotes(id);
        console.log('notes:', bookNotes);
        res.render('book_notes', { book: book, notes: bookNotes });
    } catch (error) {
        console.error('Error fetching book or notes:', error);
        res.status(500).send('Error fetching book or notes');
    }
});

app.get('/bookNotes/:id/edit', async (req, res) => {
    try {
        const id = req.params.id;
        const book = await getBook(id);
        res.render('add', { book: book });
    } catch (error) {
        console.error('Error fetching book add', error);
        res.status(500).send('Error fetching book add');
    }
});

app.get('/bookNotes/deleteBook/:id', async (req, res) => {
    const id = req.params.id;
    try {
        await db.query('DELETE FROM books WHERE id = $1', [id]);
        res.redirect('/');
    } catch (error) {
        console.error('Error deleting book:', error);
        res.status(500).send('Error deleting book');
    }

});

app.post('/updateBook/:id', upload.single('book_cover'), async (req, res) => {
    const id = req.params.id;
    const { book_title, book_author, book_des, book_date } = req.body;

    try {
        let book_cover = null;
        if (req.file) {
            book_cover = fs.readFileSync(req.file.path);
        } else {
            const book = await getBook(id);
            book_cover = Buffer.from(book.book_cover, 'base64');
        }

        await db.query('UPDATE books SET book_title = $1, book_author = $2, book_des = $3, book_cover = $4, book_date = $5 WHERE id = $6 RETURNING *',
            [book_title, book_author, book_des, book_cover, book_date, id]);
        res.redirect('/');
    } catch (error) {
        console.error('Error updating book:', error);
        res.status(500).send('Error updating book');
    }
});

app.post('/addNotes/:id', async(req, res) => {
    const id = req.params.id;
    const { note } = req.body;
    await addNotes(id, note);
    
    res.redirect(`/bookNotes/${id}`);
});

app.post('/deleteNotes/:id', async (req, res) => {
    const bookId = parseInt(req.params.id);
    let notesToDelete = req.body.notesToDelete;

    if (notesToDelete) {
        if (!Array.isArray(notesToDelete)) {
            notesToDelete = [notesToDelete];
        }

        const bookNotes = await getNotes(bookId);
        const updatedNotes = bookNotes.filter(note => !notesToDelete.includes(note));

        if (updatedNotes.length === 0) {
            await db.query('DELETE FROM notes WHERE book_id = $1', [bookId]);
        } else {
            await db.query('UPDATE notes SET notes = $1 WHERE book_id = $2', [updatedNotes, bookId]);
        }
    }

    res.redirect(`/bookNotes/${bookId}`);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});