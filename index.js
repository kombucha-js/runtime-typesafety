"use strict";

// const { preventUndefined, unprevent }   = require( 'prevent-undefined' );
// const { fold_args, the_last, the_all }  = require( 'fold-args' );
// const { schema                       }  = require( 'vanilla-schema-validator' );
// const util                       = require('util');
// const UTIL_INSPECT_CUSTOM        = require('util').inspect.custom;

const UTIL_INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom')

const CONST_TYPESAFE_INPUT       = Symbol.for( '__TYPESAFE_INPUT__'  );
const CONST_TYPESAFE_OUTPUT      = Symbol.for( '__TYPESAFE_OUTPUT__' );
const CONST_IS_TYPESAFE_FUNCTION = Symbol.for( '__IS_TYPESAFE_FUNCTION__' );
const CONST_TYPESAFE_TAGS        = Symbol.for( '__TYPESAFE_TAGS__' );

function parse_args( args ) {
  // the default
  const the_last_or_default = (e)=>e.pop() ?? ((...defs)=>(o)=>true);

  const SYM_FUNCTION = Symbol.for( 'function' );
  const SYM_STRING   = Symbol.for( 'string'  );

  // 1. fold all values in args
  args = fold_args(
    [ ...args ],
    [
      SYM_FUNCTION, SYM_STRING,
      'fn', 'tags', 'typesafe_input', 'typesafe_output', 'property',
      'on_enter', 'on_leave', 'on_leave_with_error', 'on_input_error', 'on_output_error' ,
      'unprotected_input', 'unprotected_output',
    ],
    [
      {
        typesafe_input      : the_last_or_default,
        typesafe_output     : the_last_or_default,
        property            : the_all,
        on_enter            : the_last,
        on_leave            : the_last,
        on_leave_with_error : the_last,
        on_input_error      : the_last,
        on_output_error     : the_last,
        unprotected_input   : the_last,
        unprotected_output  : the_last,
      }
    ]
  );

  // 2. treat string values as `tags`
  args['tags'].push( ...args[ SYM_STRING ] );
  args['fn'  ].push( ...args[ SYM_FUNCTION ] );
  args['fn'  ] = args['fn'  ].pop();

  // console.error( 'asd23352tgw', args);

  return args;
}

function wrap_validator( validator ) {
  return validator;
}
function wrap_validator_by_array2( validator ) {
  const wrapper_validator = schema.or( schema.array() , schema.array( validator ));
  // const wrapper_validator = schema.array( validator );

  /*
   * In order to validate argument values which are stored in `args` parameter,
   * it is necessary to wrap the validator which is specified in `typesafe_input`
   * by array() validator. But when it is wrapped by raw validators that is not
   * generated by statement compilers, accessing to its source code is not
   * available anymore.
   *
   * In order to avoid the issue, duplicate the script property to the wrapper
   * validator.
   */
  if ( 'script' in validator ) {
    Object.defineProperty( wrapper_validator, 'script', {
      value :'or( array(), array( ' + validator.script + '))',
      enumerable : false,
      writable : false,
      configurable : true,
    });
  }

  return wrapper_validator;
}

const slice_strings =(s,...range)=>s.split('\n').slice(...range).join('\n');
const edit_error_original = (error_on_occured, error_on_created)=>{
  const stacktrace_on_occured = error_on_occured.stack;
  const stacktrace_on_created = error_on_created.stack;
  const new_message = error_on_occured.message;
  const new_cause = error_on_occured.cause;

  const new_stack =
    new_message + '\n' +
    'stacktrace on occured:' + '\n' +
    slice_strings( stacktrace_on_occured,1) + '\n' +
    'stacktrace on created:' + '\n' +
    slice_strings( stacktrace_on_created,1) + '\n' +
    '\n' +
    '';

  Object.defineProperties( error_on_occured, {
    'stack': {
      value : new_stack,
      enumerable : false,
      writable : true,
      configurable : true,
    },

    'message': {
      value : new_message,
      enumerable : true,
      writable : false,
      configurable : false,
    },

    [UTIL_INSPECT_CUSTOM] : {
      value : (depth)=>{
        return {
          type : e.constructor.name,
          message: new_message,
          stack : new_stack,
          cause : new_cause,
        };
      },
      enumerable : false,
      writable : true,
      configurable : true,
    },
  });
  return error_on_occured;
};

const edit_error_simple = (error_on_occured, error_on_created)=>{
  const stacktrace_on_occured = error_on_occured.stack;
  const stacktrace_on_created = error_on_created.stack;
  Object.defineProperties( error_on_occured, {
    "typesafety_initiated_on" : {
      value : error_on_created,
      enumerable : true,
      writable : true,
      configurable : true,
    },
  });
  return error_on_occured;
};

const edit_error_thru = (error_on_occured, error_on_created)=>{
  return error_on_occured;
};


class StackTrace extends Error {
  constructor (...args) {
    super(...args);
  }
}


/**
 * all event handlers are guaranteed to be called with `this`.
 */
function typesafe_function( ...args ) {
  const {
    fn,
    typesafe_input      = ()=>null,
    typesafe_output     = ()=>null,
    tags                = [],
    property            = [],
    on_enter            = ()=>{},
    on_leave            = ()=>{},
    on_leave_with_error = ()=>{},
    on_leave_with_input_validation_failure  = null,
    on_leave_with_output_validation_failure = null, // ADDED (Mon, 08 May 2023 17:58:55 +0900)
    on_input_error      = ()=>{},
    on_output_error     = ()=>{},
    unprotected_input   = false,
    unprotected_output  = false,
  } = parse_args( args );

  // console.error( 'unprotected_input' ,  unprotected_input );
  // console.error( 'unprotected_output' , unprotected_output );

  if ( fn === null || fn === undefined ) {
    throw new ReferenceError( 'fn cannot be null or undefined' );
  }
  if ( typeof fn !== 'function' ) {
    throw new ReferenceError( `fn must be a function but ${typeof fn}` );
  }
  if ( ( CONST_IS_TYPESAFE_FUNCTION in fn ) && fn[CONST_IS_TYPESAFE_FUNCTION] ) {
    return fn;
  }

  // if ( 0<property.length ) {
  //   console.error('asd23352tgw',property);
  // }

  const fn_name = fn.name ?? 'anonymous function';

  if ( typeof typesafe_input  !== 'function' ) {
    throw new ReferenceError( `typesafe_input must be a function but ${typeof typesafe_input}` );
  }
  if ( typeof typesafe_output !== 'function' ) {
    throw new ReferenceError( `typesafe_output must be a function but ${typeof typesafe_output}` );
  }
  if ( typeof on_enter != 'function' ) {
    throw new ReferenceError( `on_enter must be a function but ${typeof on_enter} ${util.inspect(on_enter)}` );
  }
  if ( typeof on_leave != 'function' ) {
    throw new ReferenceError( `on_leave must be a function but ${typeof on_leave}` );
  }
  if ( typeof on_leave_with_error != 'function' ) {
    throw new ReferenceError( `on_leave_with_error must be a function but ${typeof on_leave_with_error}` );
  }
  if ( typeof on_input_error != 'function' ) {
    throw new ReferenceError( `on_input_error must be a function but ${typeof on_input_error}` );
  }
  if ( typeof on_output_error != 'function' ) {
    throw new ReferenceError( `on_output_error must be a function but ${typeof on_output_error}` );
  }
  // ADDED (Mon, 08 May 2023 17:58:55 +0900)
  if ( on_leave_with_input_validation_failure && ( typeof on_leave_with_input_validation_failure === 'function' ) ) {
    throw new ReferenceError( `on_leave_with_input_validation_failure must be a function but ${typeof on_leave_with_input_validation_failure}` );
  }
  // ADDED (Mon, 08 May 2023 17:58:55 +0900)
  if ( on_leave_with_output_validation_failure && ( typeof on_leave_with_output_validation_failure === 'function' ) ) {
    throw new ReferenceError( `on_leave_with_output_validation_failure must be a function but ${typeof on_leave_with_output_validation_failure}` );
  }

  const  call_handler = (thisArg, handler, handler_name, __nargs)=>{
    const __new_args =  {
      fn,
      fn_name,
      typesafe_input,
      typesafe_output,
      ...__nargs,
    };
    try {
      handler.call(thisArg,__new_args);
    } catch (e){
      console.error( `warning ${handler_name}() throws an error. ignored.`, e );
    }
  };

  const error_on_created = new StackTrace();
  // const edit_error = edit_error_simple;
  const edit_error = edit_error_thru;

  // Note that `preventUndefined` ignores null validator.
  // Also note that typesafe_input / typesafe_output are validator factories.


  // PROC1 : PREPROCES()
  const __preprocess = (thisArg, args)=>{
    call_handler(thisArg, on_enter,'on_enter', {args});

    const input_validator = wrap_validator( typesafe_input() );
    const input_validator_result = trace_validator( input_validator, args );

    if ( ! input_validator_result.value ) {
      call_handler( thisArg, on_input_error, 'on_input_error' , { trace_validator_result : input_validator_result } );
      const err =  new TypeError( 'failure of input validation error\n'  + input_validator_result.report() );
      Object.defineProperty( err, 'trace_validator_result', {
        configurable : true,
        enumerable : true,
        writable : true,
        value : input_validator_result,
      });
      throw err;
    }

    const input  = unprotected_input ? args : preventUndefined(
      args,
      {
        validator: input_validator,
        onError : (...args)=>call_handler( thisArg, on_input_error, 'on_input_error', ...args ),
      }
    );

    return input;
  };

  // PROC2 : POSTPROCESS()
  const __postprocess = ( thisArg, result )=>{
    const output_validator = typesafe_output();
    const output_validator_result = trace_validator( output_validator, result );

    if ( ! output_validator_result.value ) {
      call_handler( thisArg, on_output_error, 'on_output_error', { trace_validator_result : output_validator_result } );
      const err =  new TypeError( 'failure of output validation error\n' +  output_validator_result.report() );
      Object.defineProperty( err, 'trace_validator_result', {
        configurable : true,
        enumerable : true,
        writable : true,
        value : output_validator_result,
      });
      throw err;
    }

    const output = unprotected_output ? result : preventUndefined(
      result,
      {
        validator : output_validator,
        onError : (...args)=>call_handler( thisArg, on_output_error, 'on_output_error', ...args ),
      });

    call_handler( thisArg, on_leave,'on_leave', {result} );

    return output;
  };

  // PROC3 : CATCH_ERROR()
  const __catch_error = ( thisArg, e )=>{
    e = edit_error(e, error_on_created);
    const __nargs = {
      error : e,
    };
    if ( 'trace_validator_result' in e ) {
      __nargs.trace_validator_result = e.trace_validator_result;
    }
    call_handler( thisArg, on_leave_with_error, 'on_leave_with_error', __nargs );
    return e;
  };

  const result = (()=>{
    if ( fn.constructor.name === 'AsyncFunction' ) {
      return   async   function (...args) {
        try {
          const input  = __preprocess( this, args );
          const result = await ( fn.apply( this, input ) );
          const output = __postprocess( this, result );
          return output;
        } catch ( e ) {
          throw __catch_error( this, e );
        }
      };
    } else {
      return /*async*/ function (...args) {
        try {
          const input  = __preprocess( this, args );
          const result = /* await */ ( fn.apply( this, input ) );
          const output = __postprocess( this, result );
          return output;
        } catch ( e ) {
          throw __catch_error( this, e );
        }
      };
    }
  })();

  Object.defineProperties( result, {
    // Set the flag;
    [CONST_IS_TYPESAFE_FUNCTION] : {
      value: true,
      writable : false,
      enumerable : false,
      configurable : true,
    },
    // Set the name of the wrapper function to the name of the corresponding function;
    'name' : {
      value: fn.name + '(typesafe-function)',
      writable : false,
      enumerable : false,
      configurable : true,
    },
    [CONST_TYPESAFE_OUTPUT] : {
      value: typesafe_output,
      writable : false,
      enumerable : false,
      configurable : true,
    },
    [CONST_TYPESAFE_INPUT] : {
      value: typesafe_input,
      writable : false,
      enumerable : false,
      configurable : true,
    },
    [CONST_TYPESAFE_TAGS] : {
      value : [ ...tags ],
      writable : false,
      enumerable : false,
      configurable : true,
    },
    ...Object.assign({},... property),
  });

  return preventUndefined( result );
}

function check_if_function( value ) {
  if ( value === null || value === undefined ) {
    throw new ReferenceError( `argument was not specified '${value}'` );
  }
  if ( typeof value !== 'function' ) {
    throw new ReferenceError( `argument must be either an object, an array or a function '${value}'` );
  }
  return value;
}

function check_if_object( value ) {
  if ( value === null || value === undefined ) {
    throw new ReferenceError( `argument was not specified '${value}'` );
  }
  if ( typeof value !== 'object' && typeof value !== 'function' ) {
    throw new ReferenceError( `argument must be either an object, an array or a function '${value}'` );
  }
  return value;
}

function get_input_typesafe_info( input_fn ) {
  check_if_function( input_fn );

  if ( CONST_TYPESAFE_INPUT in input_fn ) {
    return input_fn[CONST_TYPESAFE_INPUT];
  } else {
    return null;
  }
}

function get_output_typesafe_info( input_fn ) {
  check_if_function( input_fn );

  if ( CONST_TYPESAFE_OUTPUT in input_fn ) {
    return input_fn[CONST_TYPESAFE_OUTPUT];
  } else {
    return null;
  }
}

function get_typesafe_tags( value ) {
  check_if_object( value );

  if ( CONST_TYPESAFE_TAGS in value ) {
    return value[CONST_TYPESAFE_TAGS];
  } else {
    return [];
  }
}

function set_typesafe_tags( value, ...tags ) {
  check_if_object( value );

  Object.defineProperties( value, {
    [CONST_TYPESAFE_TAGS] : {
      value : [ ...tags ],
      writable : false,
      enumerable : false,
      configurable : true,
    },
  });
  return value;
}


function no_typesafe_function(...args) {
  const {
    fn,
    typesafe_input      = ()=>null,
    typesafe_output     = ()=>null,
    tags                = [],
    property            = [],
    on_enter            = ()=>{},
    on_leave            = ()=>{},
    on_leave_with_error = ()=>{},
    on_input_error      = ()=>{},
    on_output_error     = ()=>{},
  } = parse_args( args );
  return fn;
}

// module.exports.typesafe_function = typesafe_function;
// module.exports.no_typesafe_function = no_typesafe_function;
// module.exports.get_typesafe_tags = get_typesafe_tags;
// module.exports.get_output_typesafe_info = get_output_typesafe_info
// module.exports.get_input_typesafe_info  = get_input_typesafe_info;

// module.exports = module.exports;

