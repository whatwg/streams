(function()
{
  if (!global.gc)
  {
    global.gc = function()
    {
      if (global.GCController)
        return GCController.collect();
      function gcRec(n) {
        if (n < 1)
          return {};
        var temp = {i: "ab" + i + (i / 100000)};
        temp += "foo";
        gcRec(n-1);
      }
      for (var i = 0; i < 10000; i++)
        gcRec(10);
    }
  }
})();
