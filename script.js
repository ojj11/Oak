function executeCode(code, OAKresultfunc) {
  //Unfortunately we have to have at least one callback variable defined,
  //if user code overwrites OAKresultfunc then Oak won't work anymore.
  return eval("var code = undefined;" + code);
}
//By using a closure to create a new scope, we can hide all of Oak
//internals from the user script, meaning less chance that the user can
//accidentally break something.
(function () {
  var variables = {};
  document.getElementById("input").focus();
  function example() {
    input.value = [
      "var output;",
      "var rand = Math.random();",
      "rand *= scalar;",
      "",
      "if(roundUp) {",
      "  output = Math.ceil(rand);",
      "} else {",
      "  output = Math.floor(rand);",
      "}"
    ].join("\n");
    fullUpdate();
    return false;
  }
  document.getElementById("example").onclick = example;
  /* walk(node, callback) walks over each node in the AST
    running the callback passing the AST node
   Modified from https://github.com/substack/node-burrito */
  function walk(node, fn) {
    Object.keys(node).forEach(function (key) {
      if (key === "parent")
        return;
      var child = node[key];
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c && (typeof c.type === "string" || key == "properties")) {
            c.parent = node;
            walk(c, fn);
          }
        });
      } else if (child && typeof child.type === "string") {
        child.parent = node;
        walk(child, fn);
      }
    });
    fn(node);
  }
  /* Checks to see if somewhere above the node, a parent node with the given
    string type exists */
  function desc(node, string) {
    for (var parent = node.parent; parent; parent = parent.parent) {
      if (parent.type == string) {
        return true;
      }
    }
    return false;
  }
  /* Used by the setDiff function and setUnion */
  function stringify(e) {
    return e.name;
  }
  /* Creates a set of set1 - set2. set1 / set2 in haskell. Can work with any
    data types, including objects (just change the stringify function
    to hash the object into a unique value */
  function setDiff(set1, set2) {
    var set1hashes = [];
    var set2hashes = [];
    var diff = [];
    set2.forEach(function (elem) {
      set2hashes.push(stringify(elem));
    });
    set1.forEach(function (elem) {
      var hash = stringify(elem);
      // unary operator ~ moves -1 to false, and everything else to true.
      if (!~set2hashes.indexOf(hash) && !~set1hashes.indexOf(hash)) {
        set1hashes.push(hash);
        diff.push(elem);
      }
    });
    return diff;
  }
  /* Similar to above, but creates a union of two sets. */
  function setUnion(set1, set2) {
    var unionhashes = [];
    var union = [];
    var sets = [
        set1,
        set2
      ];
    sets.forEach(function (set) {
      set.forEach(function (elem) {
        var hash = stringify(elem);
        if (!~unionhashes.indexOf(hash)) {
          unionhashes.push(hash);
          union.push(elem);
        }
      });
    });
    return union;
  }
  /* Support function for adding an AST value to an array */
  function addNode(array, node) {
    array.push({
      "loc": node.loc,
      "name": node.name
    });
  }
  /* closure parses the closure given as an AST, and returns required
    variables. */
  function closure(AST, d) {
    var required = [];
    var given = d.given;
    walk(AST, function (node) {
      if (node.type == "ExpressionStatement" && node.expression.loc) {
        //If it's an expression, decorate the node with a call back into
        // the Oak framework.
        var newnode = {
            "type": "CallExpression",
            "callee": {
              "type": "Identifier",
              "name": "OAKresultfunc"
            },
            "arguments": [
              node.expression,
              {
                "type": "Literal",
                "value": node.expression.loc.start.line
              }
            ]
          };
        node.expression = newnode;
      }
      if (node.type == "VariableDeclarator" && node.id.type == "Identifier") {
        given.push({
          "loc": node.id.loc,
          "name": node.id.name
        });
      }
      if (node.type == "Identifier") {
        //If descendant of MemberExpression, Declaration or closure ignore
        if (desc(node, "MemberExpression"))
          return;
        if (desc(node, "FunctionDeclaration"))
          return;
        if (desc(node, "FunctionExpression"))
          return;
        if (desc(node, "VariableDeclarator")) {
          addNode(required, node);
          return;
        }
        if (!desc(node, "VariableDeclaration")) {
          addNode(required, node);
        } else {
          addNode(given, node);
        }
      }
      if (node.type == "MemberExpression"
            && node.object.type == "Identifier") {
        addNode(required, node.object);
      }
      if (node.type == "FunctionDeclaration" ||
            node.type == "FunctionExpression") {
        //Handles the special case of closures:
        if (node.id)
          addNode(given, node.id);
        var given2 = [];
        given2.prototype = given;
        //Add closure parameters as given variables but only within this
        //scope.
        node.params.forEach(function (p) {
          addNode(given2, p);
        });
        //Cut this node out, so we can run it recursively through this
        //function without having to worry about it's context.
        var parent = node.body.parent;
        node.body.parent = undefined;
        //Recurse:
        var closure_required2 = closure(node.body, {
            "required": required,
            "given": given2
          });
        node.body.parent = parent;
        closure_required2 = setDiff(closure_required2, given2);
        required = setUnion(d.required, closure_required2);
      }
    });
    //Needed variables in this closure:
    var closure_needed = setDiff(required, given);
    //Return the required variables with those of other closures:
    return setUnion(d.required, closure_needed);
  }
  //fullUpdate is called when the user enters new information into the system:
  function fullUpdate() {
    var required = [];
    var given = [];
    try {
      var AST = window.acorn.parse(document.getElementById("input").value, {
          locations: true,
          location: true
        });
    } catch (e) {
      document.getElementById("output").innerHTML = "Syntax Error:<hr>"
                                                                  + e.message;
      return [];
    }
    //closure alters the given and required variables, as well as decorating
    //the AST.
    required = closure(AST, {
      "required": required,
      "given": given
    });
    option = {
      format: {
        indent: { style: " " },
        quotes: "double"
      }
    };
    //Rebuild the code now we've parsed and decorated it:
    var code = "";
    code = window.escodegen.generate(AST, option);
    var lines = [];
    //A result function for passing the results of expressions back into
    //the Oak framework.
    var result = function (result, store) {
      if (result == undefined)
        return;
      if (!lines[store]) {
        lines[store] = document.createElement("span");
        lines[store].innerHTML = result;
      } else {
        lines[store].innerHTML += ", " + result;
      }
    };
    //Put the algorithm with the declarations from the user, then we can 
    //run the user's script:
    try {
      var vars = "";
      Object.keys(variables).forEach(function (v) {
        if (variables[v]) {
          vars += "var " + v + " = " + variables[v] + ";";
        }
      });
      fakeRandom.x = 0;
      executeCode(vars + code, result);
    } catch (e) {
    }
    //Fluents are the variables that are undefined within the user's script
    //we build an UI so that they can be defined:
    var fluents = [];
    required.forEach(function (r) {
      if (!r.loc)
        return;
      if (window[r.name])
        return;
      var span = document.createElement("span");
      span.innerHTML = r.name + " = ";
      span.style.textAlign = "left";
      var input = document.createElement("input");
      input.type = "text";
      if (!variables[r.name]) {
        variables[r.name] = "";
      }
      if (variables[r.name] != "") {
        input.style.backgroundColor = "#8e452f";
        input.style.color = "white";
      }
      input.value = variables[r.name];
      input.onkeyup = function (e) {
        if (variables[r.name] != "") {
          input.style.backgroundColor = "#8e452f";
          input.style.color = "white";
        }
        try {
          eval("var ignore_me = " + this.value + ";");
          variables[r.name] = this.value;
        } catch (e) {
          input.style.backgroundColor = "white";
          input.style.color = "black";
          return;
        }
        if (e.keyCode == 13) {
          fullUpdate();
          this.blur();
        }
      };
      span.appendChild(input);
      fluents.push(span);
    });
    document.getElementById("output").innerHTML = "";
    /* Add the fluent's UI to the screen: */
    for (var i = 0; i < fluents.length; ++i) {
      if (fluents[i]) {
        document.getElementById("output").appendChild(fluents[i]);
      }
    }
    var br = document.createElement("br");
    document.getElementById("output").appendChild(br);
    document.getElementById("input").style.paddingTop = 30 + (fluents.length + 1) * 18 + "px";
    for (var i = 1; i < lines.length; ++i) {
      if (lines[i]) {
        document.getElementById("output").appendChild(lines[i]);
      } else {
        var br = document.createElement("br");
        document.getElementById("output").appendChild(br);
      }
    }
    document.getElementById("output").scrollTop = document.getElementById("input").scrollTop;
  }
  document.getElementById("input").onkeyup = fullUpdate;
  document.getElementById("input").onscroll = function (e) {
    document.getElementById("output").scrollTop = document.getElementById("input").scrollTop;
  };

  fakeRandom.x = 0;
  fakeRandom.randoms = [];
  for (var i = 0; i < 100; ++i) {
    fakeRandom.randoms.push(Math.random());
  }
  function fakeRandom() {
    return fakeRandom.randoms[fakeRandom.x++ % 100];
  }
  Math.random = fakeRandom;
  window.alert = function () {
  };
  window.prompt = function () {
  };
  window.confirm = function () {
  };
}());
