$(document).ready(function() {

	$('#login').submit(function(e) {
		e.preventDefault();
		var data = $('form').serialize();
		var url = $('form').attr('action');

		$('#login').addClass('loading');

		$.post(url, data, function(rsp) {
			if (rsp.ok) {
				$('#login').addClass('email-sent');
				$('#login input[name="email"]').val('');
			} else {
				$('#response').html(rsp.error);
			}
			$('#login').removeClass('loading');
		});
	});

});
