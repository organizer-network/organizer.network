$(document).ready(function() {

	$('#login').submit(function(e) {
		e.preventDefault();

		if ($('#login').hasClass('loading')) {
			return;
		}

		var data = $('#login').serialize();
		var url = $('#login').attr('action');

		$('#login').addClass('loading');

		$.post(url, data, function(rsp) {
			if (rsp.ok) {
				$('#login').addClass('email-sent');
				$('#login input[name="email"]').val('');
			} else {
				$('#login-response').html(rsp.error);
			}
			$('#login').removeClass('loading');
		}).fail(function() {
			$('#login-response').html('Error connecting to server.');
			$('#login').removeClass('loading');
		});
	});

	$("#send #content").keyup(function(e) {
		while($(this).outerHeight() < this.scrollHeight + parseFloat($(this).css("borderTopWidth")) + parseFloat($(this).css("borderBottomWidth"))) {
			$(this).height($(this).height() + 1);
		};
	});

	$('#send').submit(function(e) {
		e.preventDefault();

		if ($('#send').hasClass('loading')) {
			return;
		}

		var data = $('#send').serialize();
		var url = $('#send').attr('action');

		$('#send').addClass('loading');

		$.post(url, data, function(rsp) {
			if (rsp.ok) {
				$('#send').addClass('message-sent');
				$('#send textarea[name="content"]').val('');

				$.get('/api/message/' + rsp.message_id, function(rsp) {
					$('#message-list').prepend(rsp);
				});

			} else {
				$('#send-response').html(rsp.error);
			}
			$('#send').removeClass('loading');
		}).fail(function() {
			$('#send-response').html('Error connecting to server.');
			$('#send').removeClass('loading');
		});
	});

	if ($('#context').length > 0) {
		$('#intro').removeClass('hidden');
		$('#intro').addClass('above');
		document.body.scrollTo(0, $('#context').offset().top - 32);
	}

});
