/**
 * @file Cursor.js - based on Monglo#Cursor ({@link https://github.com/Monglo}) by Christian Sullivan <cs@euforic.co> | Copyright (c) 2012
 * @version 0.0.1
 * 
 * @author Eduardo Astolfi <eduardo.astolfi91@gmail.com>
 * @copyright 2016 Eduardo Astolfi <eduardo.astolfi91@gmail.com>
 * @license MIT Licensed
 */

var Logger = require("./utils/Logger"),
    _ = require("lodash"),
    Selector = require('./Selector');

/**
 * Cursor
 * 
 * @module Cursor
 * @constructor
 * @since 0.0.1
 * 
 * @classdesc Cursor class that maps a MongoDB-like cursor
 * 
 * @param {MongoPortable} db - Additional options
 * @param {Collection} collection - The collection instance
 * @param {Object|Array|String} [selection={}] - The selection for matching documents
 * @param {Object|Array|String} [fields={}] - The fields of the document to show
 * @param {Object} [options] - Database object
 * 
 * @param {Object} [options.pkFactory=null] - Object overriding the basic "ObjectId" primary key generation.
 * 
 */
function Cursor(db, collection, selection, fields, options) {
    this.db = db;
    this.collection = collection;
    this.selector = selection;
    this.fields = fields;
    this.skipValue = options.skip;
    this.limitValue = options.limit;
    this.sortValue = options.sort || null;
    this.sorted = false;

    if (Selector.isCompiled(this.selector)) {
        this.selector_compiled = this.selector;
    } else {
        this.selector_compiled = Selector._compileSelector(this.selector);
    }
    
    if (this.selector_compiled._id) {
        this.selector_id = this.selector_compiled._id;
    }
    
    this.sort_compiled = Selector._compileSort(this.sortValue);

    this.db_objects = null;
    this.cursor_pos = 0;
}

/**
 * Moves a cursor to the begining
 * 
 * @method Cursor#rewind
 */
Cursor.prototype.rewind = function() {
    this.db_objects = null;
    this.cursor_pos = 0;
};

/**
 * Iterates over the cursor, calling a callback function
 * 
 * @method Cursor#forEach
 * 
 * @param {Function} [callback=null] - Callback function to be called for each document
 */
Cursor.prototype.forEach = function(callback) {
    let docs = this.fetchAll();
    
    for (let i = 0; i < docs.length; i++) {
        callback(docs[i]);
    }
};

/**
 * Iterates over the cursor, returning a new array with the documents affected by the callback function
 * 
 * @method Cursor#map
 * 
 * @param {Function} [callback=null] - Callback function to be called for each document
 * 
 * @returns {Array} The documents after being affected with the callback function
 */
Cursor.prototype.map = function(callback) {
    var res = [];

    this.forEach(function (doc) {
        res.push(callback(doc));
    });

    return res;
};

/**
 * Checks if the cursor has one document to be fetched
 * 
 * @method Cursor#hasNext
 * 
 * @returns {Boolean} True if we can fetch one more document
 */
Cursor.prototype.hasNext = function() {
    return (this.cursor_pos < this.collection.docs.length);
};

/**
 * Alias for {@link Cursor#fetchOne}
 * 
 * @method Cursor#next
 */
Cursor.prototype.next = function() {
    return this.fetchOne();
};

/**
 * Alias for {@link Cursor#fetchAll}
 * 
 * @method Cursor#fetch
 */
Cursor.prototype.fetch = function() {
    return this.fetchAll();
};

/**
 * Fetch all documents in the cursor
 * 
 * @method Cursor#fetchAll
 * 
 * @returns {Array} All the documents contained in the cursor
 */
Cursor.prototype.fetchAll = function() {
    return _getDocuments(this, false);
};

/**
 * Retrieves the next document in the cursor
 * 
 * @method Cursor#fetchOne
 * 
 * @returns {Object} The next document in the cursor
 */
Cursor.prototype.fetchOne = function() {
    return _getDocuments(this, true);
};

/**
 * Retrieves one or all the documents in the cursor
 * 
 * @method _getDocuments
 * @private
 * 
 * @param {Cursor} cursor - The cursor with the documents
 * @param {Boolean} [justOne=false] - Whether it retrieves one or all the documents
 * 
 * @returns {Array|Object} If [justOne=true] returns the next document, otherwise returns all the documents
 */
var _getDocuments = function(cursor, justOne) {
    if (cursor.selector_id && _.hasIn(cursor.collection.doc_indexes, cursor.selector_id)) {
        let idx = cursor.collection.doc_indexes[_.toString(cursor.selector_id)];
        
        return cursor.collection.docs[idx];
    }
    
    if (_.isNil(justOne)) {
        justOne = false;
    }
    
    // TODO add warning when sort/skip/limit and fetching one
    // TODO add warning when skip/limit without order
    // TODO index
    while (cursor.cursor_pos < cursor.collection.docs.length) {
        var _doc = cursor.collection.docs[cursor.cursor_pos];
        cursor.cursor_pos++;
        
        if (cursor.selector_compiled.test(_doc)) {
            if (_.isNil(cursor.db_objects)) cursor.db_objects = [];
            
            if (!_.isNil(cursor.fields) && _.isPlainObject(cursor.fields) && !_.isEqual(cursor.fields, {})) {
                let tmp = {};
                
                if (!_.hasIn(cursor.fields, '_id') || cursor.fields._id !== -1) {
                    tmp._id = _doc._id;
                }
                
                for (let field in cursor.fields) {
                    if (cursor.fields[field] !== -1) {
                        tmp[field] = _doc[field];
                    }
                }
                
                _doc = tmp;
            }
            
            cursor.db_objects.push(_doc);
            
            if (justOne) {
                // Add force sort
                return _doc;
            }
        }
    }
    
    if (!cursor.sorted && hasSorting(cursor)) cursor.sort();
    
    var idxFrom = cursor.skipValue;
    var idxTo = cursor.limitValue !== -1 ? (cursor.limitValue + idxFrom) : cursor.db_objects.length;
    
    return cursor.db_objects.slice(idxFrom, idxTo);
    
};

/**
 * Obtains the total of documents of the cursor
 * 
 * @method Cursor#count
 * 
 * @returns {Number} The total of documents in the cursor
 */
Cursor.prototype.count = function() {
    return this.fetchAll().length;
};

/**
 * Applies a sorting on the cursor
 * 
 * @method Cursor#sort
 * 
 * @param {Object|Array|String} spec - The sorting specification
 * 
 * @returns {Cursor} This instance so it can be chained with other methods
 */
Cursor.prototype.sort = function(spec) {
    var _sort = this.sort_compiled || null;
    
    if (spec) {
        _sort = Selector._compileSort(spec);
    }
    
    if (_sort) {
        if (spec) {
            this.sortValue = spec;
            this.sort_compiled = _sort;
        } else {
            // If no spec, do sort
            if (_.isNil(this.db_objects) || !_.isArray(this.db_objects)) {
                throw new Error("You need to fetch the data in order to sort it");
            } else {
                this.db_objects = this.db_objects.sort(_sort);
                this.sorted = true;
            }
        }
    } else {
        throw new Error("You need to specify a sort order");
    }
    
    return this;
};

/**
 * Set the number of document to skip when fetching the cursor
 * 
 * @method Cursor#skip
 * 
 * @param {Number} skip - The number of documents to skip
 * 
 * @returns {Cursor} This instance so it can be chained with other methods
 */
Cursor.prototype.skip = function(skip) {
    if (_.isNil(skip) || _.isNaN(skip)) throw new Error("Must pass a number");
    
    this.skipValue = skip;
    
    return this;
};

/**
 * Set the max number of document to fetch
 * 
 * @method Cursor#limit
 * 
 * @param {Number} limit - The max number of documents
 * 
 * @returns {Cursor} This instance so it can be chained with other methods
 */
Cursor.prototype.limit = function(limit) {
    if (_.isNil(limit) || _.isNaN(limit)) throw new Error("Must pass a number");
    
    this.limitValue = limit;
    
    return this;
};

/**
 * Checks if a cursor has a sorting defined
 * 
 * @method hasSorting
 * @private
 * 
 * @param {Cursor} cursor - The cursor
 * 
 * @returns {Boolean} Whether the cursor has sorting or not
 */
var hasSorting = function(cursor) {
    if (_.isNil(cursor.sortValue)) return false;
    
    if (_.isNil(cursor.sort_compiled)) {
        return false;
    }
    
    return true;
};

/**
 * @todo Implement
 */
Cursor.prototype.batchSize = function() {
    // Controls the number of documents MongoDB will return to the client in a single network message.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.close = function() {
    // Close a cursor and free associated server resources.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.comment = function() {
    // Attaches a comment to the query to allow for traceability in the logs and the system.profile collection.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.explain = function() {
    // Reports on the query execution plan for a cursor.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.hint = function() {
    // Forces MongoDB to use a specific index for a query.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.itcount = function() {
    // Computes the total number of documents in the cursor client-side by fetching and iterating the result set.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.maxScan = function() {
    // Specifies the maximum number of items to scan; documents for collection scans, keys for index scans.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.maxTimeMS = function() {
    // Specifies a cumulative time limit in milliseconds for processing operations on a cursor.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.max = function() {
    // Specifies an exclusive upper index bound for a cursor. For use with cursor.hint()
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.min = function() {
    // Specifies an inclusive lower index bound for a cursor. For use with cursor.hint()
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.noCursorTimeout = function() {
    // Instructs the server to avoid closing a cursor automatically after a period of inactivity.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.objsLeftInBatch = function() {
    // Returns the number of documents left in the current cursor batch.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.pretty = function() {
    // Configures the cursor to display results in an easy-to-read format.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.readConcern = function() {
    // Specifies a read concern for a find() operation.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.readPref = function() {
    // Specifies a read preference to a cursor to control how the client directs queries to a replica set.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.returnKey = function() {
    // Modifies the cursor to return index keys rather than the documents.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.showRecordId = function() {
    // Adds an internal storage engine ID field to each document returned by the cursor.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.size = function() {
    // Returns a count of the documents in the cursor after applying skip() and limit() methods.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.snapshot = function() {
    // Forces the cursor to use the index on the _id field. Ensures that the cursor returns each document, 
    // with regards to the value of the _id field, only once.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.tailable = function() {
    // Marks the cursor as tailable. Only valid for cursors over capped collections.
    throw new Error("Not yet implemented");
};

/**
 * @todo Implement
 */
Cursor.prototype.toArray = function() {
    // Returns an array that contains all documents returned by the cursor.
    throw new Error("Not yet implemented");
};

module.exports = Cursor;