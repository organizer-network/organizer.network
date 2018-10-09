$(document).ready(function() {
	$('form').submit(function(e) {
		e.preventDefault();
		var data = $('form').serialize();
		var url = $('form').attr('action');
		$.post(url, data, function(rsp) {
			
		});
	});
});
